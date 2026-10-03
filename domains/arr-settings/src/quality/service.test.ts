/**
 * Plan, apply, drift and restore against a mock *Arr over real HTTP.
 *
 * The planner's own tests cover what to write. These cover what actually
 * goes over the wire: the order of the writes, that a profile refers to
 * formats by the ids the server handed back, that the second apply is a
 * no-op, and that a restore puts the server back the way it was.
 */

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@tinkerbell/db/test-db";
import { arrManagedProfiles, arrQualityProfiles } from "@tinkerbell/db";
import { qualityPreset } from "@tinkerbell/contracts";
import type { ArrInstance, ArrInstances } from "@tinkerbell/core";
import type { ChangeRecord } from "@tinkerbell/ports";
import { createArrLibrary } from "@tinkerbell/domain.arr-library";
import { startMockRadarr, startMockSonarr, type MockArr } from "@tinkerbell/test-support";
import { createArrSettings, PlanConflictError, PlanError } from "../index.ts";

const HD = qualityPreset("radarr-hd-bluray-web")!;

function instancesOf(...list: ArrInstance[]): ArrInstances {
  return {
    arrInstances: () => list,
    resolveArrInstance: (_service: string, id?: string) => list.find((i) => i.id === id) ?? list[0] ?? null,
  } as unknown as ArrInstances;
}

describe("quality presets against a live instance", () => {
  let t: TestDb;
  let mock: MockArr;
  let changes: ChangeRecord[];
  let events: Array<{ type: string; message: string }>;
  let settings: ReturnType<typeof createArrSettings>;
  let instance: ArrInstance;

  async function setup(start: () => Promise<MockArr>, service: "radarr" | "sonarr" = "radarr") {
    mock = await start();
    instance = {
      id: service,
      service,
      name: service === "radarr" ? "Radarr" : "Sonarr",
      url: mock.origin,
      apiKey: "k",
      isDefault: true,
    };
    const library = createArrLibrary({ db: t.db });
    settings = createArrSettings({
      db: t.db,
      arr: instancesOf(instance),
      refreshConfigMirror: (i, c) => library.refreshConfigMirror(i, c),
      recordChange: (c) => changes.push(c),
      emitEvent: (type, message) => events.push({ type, message }),
      now: () => Date.now(),
    });
  }

  beforeEach(() => {
    t = createTestDb();
    changes = [];
    events = [];
  });
  afterEach(async () => {
    await mock?.close();
    t.dispose();
  });

  const request = { instanceId: "radarr", presetId: HD.id, limit: HD.defaultLimit, target: { name: "HD" } };

  test("apply writes formats, then sizes, then the profile, wired by the server's ids", async () => {
    await setup(() => startMockRadarr([]));
    const { plan, fingerprint } = await settings.quality.plan(request);
    const result = await settings.quality.apply({ ...request, fingerprint });
    assert.equal(result.changes, plan.steps.length);

    const writes = mock.journal.settingsWrites.map((w) => `${w.method} ${w.path}`);
    const lastFormat = writes.lastIndexOf("POST /api/v3/customformat");
    assert.ok(lastFormat >= 0);
    assert.ok(writes.indexOf("PUT /api/v3/qualitydefinition/update") > lastFormat);
    assert.equal(writes.at(-1), "POST /api/v3/qualityprofile");

    const profile = [...mock.quality.profiles.values()].find((p) => p.name === "HD")!;
    const formatIds = new Map([...mock.quality.customFormats.values()].map((f) => [f.name, f.id]));
    const items = profile.formatItems as Array<{ format: number; name: string; score: number }>;
    const brDisk = items.find((f) => f.name === "BR-DISK")!;
    assert.equal(brDisk.format, formatIds.get("BR-DISK"));
    assert.equal(brDisk.score, -10000);

    // Tinkerbell now owns it, the change log says so, and the mirror has it.
    const row = t.db.select().from(arrManagedProfiles).get()!;
    assert.equal(row.arrProfileId, profile.id);
    assert.equal(row.status, "in_sync");
    assert.equal(changes.at(-1)?.entity, "arr_quality_profile");
    assert.equal(changes.at(-1)?.action, "create");
    const mirrored = t.db.select().from(arrQualityProfiles).where(eq(arrQualityProfiles.name, "HD")).get();
    assert.ok(mirrored, "the new profile reached the mirror without waiting for sync-arr");
  });

  test("a second plan after applying changes nothing", async () => {
    await setup(() => startMockRadarr([]));
    const first = await settings.quality.plan(request);
    await settings.quality.apply({ ...request, fingerprint: first.fingerprint });
    const id = [...mock.quality.profiles.values()].find((p) => p.name === "HD")!.id as number;
    const second = await settings.quality.plan({ ...request, target: { profileId: id } });
    assert.deepEqual(second.plan.steps, []);
  });

  test("apply refuses a preview the instance has moved on from", async () => {
    await setup(() => startMockRadarr([]));
    const { fingerprint } = await settings.quality.plan(request);
    mock.quality.customFormats.set(50, { id: 50, name: "LQ", specifications: [] });
    await assert.rejects(settings.quality.apply({ ...request, fingerprint }), PlanConflictError);
    assert.equal(mock.journal.settingsWrites.length, 0, "nothing was written");
  });

  test("an edit made in Radarr is reported as drift, once", async () => {
    await setup(() => startMockRadarr([]));
    const { fingerprint } = await settings.quality.plan(request);
    await settings.quality.apply({ ...request, fingerprint });

    const profile = [...mock.quality.profiles.values()].find((p) => p.name === "HD")!;
    profile.cutoffFormatScore = 50;

    const [row] = await settings.quality.checkInstance("radarr");
    assert.equal(row.status, "drifted");
    assert.deepEqual(
      (row.drift as Array<{ path: string }>).map((d) => d.path),
      ["profile.cutoffFormatScore"],
    );
    await settings.quality.checkInstance("radarr");
    assert.equal(
      events.filter((e) => e.type === "arr.quality_drift").length,
      1,
      "the transition notifies, not every check",
    );
  });

  test("a profile deleted in Radarr is reported missing", async () => {
    await setup(() => startMockRadarr([]));
    const { fingerprint } = await settings.quality.plan(request);
    const { managed } = await settings.quality.apply({ ...request, fingerprint });
    mock.quality.profiles.delete(managed.arrProfileId!);
    const [row] = await settings.quality.checkInstance("radarr");
    assert.equal(row.status, "missing");
  });

  test("restore puts back what the apply changed and removes what it created", async () => {
    await setup(() => startMockRadarr([]));
    const definitionsBefore = structuredClone(mock.quality.definitions);
    mock.quality.customFormats.set(1, {
      id: 1,
      name: "LQ",
      includeCustomFormatWhenRenaming: false,
      specifications: [],
    });

    const { fingerprint } = await settings.quality.plan(request);
    const { snapshotId } = await settings.quality.apply({ ...request, fingerprint });
    assert.ok(
      (mock.quality.customFormats.get(1)!.specifications as unknown[]).length > 0,
      "LQ was adopted and updated",
    );

    const { warnings } = await settings.quality.restore(snapshotId);
    assert.deepEqual(warnings, []);
    assert.deepEqual(mock.quality.customFormats.get(1)!.specifications, [], "LQ is back as it was");
    assert.equal(mock.quality.customFormats.size, 1, "formats the apply created are gone");
    assert.ok(![...mock.quality.profiles.values()].some((p) => p.name === "HD"), "the created profile is gone");
    assert.deepEqual(mock.quality.definitions, definitionsBefore);
    assert.equal(t.db.select().from(arrManagedProfiles).all().length, 0);
  });

  test("Sonarr v3 is refused before anything is written", async () => {
    await setup(() => startMockSonarr([], { version: "3.0.10" }), "sonarr");
    const sonarr = qualityPreset("sonarr-web-1080p")!;
    await assert.rejects(
      settings.quality.plan({
        instanceId: "sonarr",
        presetId: sonarr.id,
        limit: sonarr.defaultLimit,
        target: { name: "TV" },
      }),
      PlanError,
    );
    const { presets } = await settings.quality.presets("sonarr");
    assert.ok(presets.every((p) => !p.available));
    assert.match(presets[0].unavailableReason ?? "", /Sonarr v4/);
  });

  test("an imported row waits as missing and is filled in by its first apply", async () => {
    await setup(() => startMockRadarr([]));
    assert.equal(
      settings.quality.importManaged([
        { instanceId: "radarr", profileName: "HD", presetId: HD.id, limits: HD.defaultLimit },
      ]),
      1,
    );
    const { fingerprint } = await settings.quality.plan(request);
    await settings.quality.apply({ ...request, fingerprint });
    const rows = t.db.select().from(arrManagedProfiles).all();
    assert.equal(rows.length, 1);
    assert.ok(rows[0].arrProfileId);
  });
});
