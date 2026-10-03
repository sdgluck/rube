/**
 * `updateJob`: what a save is allowed to do to a stored job.
 *
 * The bug this file exists for: saves used to replace the whole config, and
 * the generic job page saved only `sections` — so saving "Remove Overlays"
 * dropped `mode: "remove"` and the job started *applying* overlays.
 */
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { desc, eq } from "drizzle-orm";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { DbToken, changeLog, jobs } from "@tinkerbell/db";
import { JobConfigError } from "@tinkerbell/contracts";
import { createRunner, JobUpdateError } from "./runner.ts";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { updateJob } = createRunner(c.resolve(ServicesToken));

function seed(id: string, command: string, config: Record<string, unknown> = {}): void {
  db.delete(jobs).where(eq(jobs.id, id)).run();
  db.insert(jobs)
    .values({ id, name: `Test ${id}`, command, schedule: "", enabled: 1, config })
    .run();
}

function configOf(id: string): Record<string, unknown> {
  return db.select().from(jobs).where(eq(jobs.id, id)).get()!.config;
}

describe("configPatch", () => {
  beforeEach(() => seed("byw", "because-you-watched", { limit: 12, mode: "server", sections: ["Films"] }));

  it("merges into the stored config instead of replacing it", () => {
    updateJob("byw", { configPatch: { limit: 20 } });
    assert.deepEqual(configOf("byw"), { limit: 20, mode: "server", sections: ["Films"] });
  });

  it("clears a key with null, and an empty list means 'all'", () => {
    updateJob("byw", { configPatch: { mode: null, sections: [] } });
    assert.deepEqual(configOf("byw"), { limit: 12 });
  });

  it("rejects a value outside the command's bounds, writing nothing", () => {
    assert.throws(() => updateJob("byw", { configPatch: { limit: 999 } }), JobConfigError);
    assert.equal(configOf("byw").limit, 12);
  });

  it("rejects a key the command doesn't know", () => {
    assert.throws(() => updateJob("byw", { configPatch: { limt: 5 } }), /Unknown setting: limt/);
  });

  it("checks rules that span fields", () => {
    assert.throws(() => updateJob("byw", { configPatch: { minItems: 40, maxItems: 20 } }), /can't be more than/);
  });

  it("refuses a patch and a whole config together, or an empty patch", () => {
    assert.throws(() => updateJob("byw", { config: {}, configPatch: { limit: 3 } }), JobUpdateError);
    assert.throws(() => updateJob("byw", { configPatch: {} }), JobUpdateError);
  });

  it("records one history row holding the merged config", () => {
    updateJob("byw", { configPatch: { limit: 30 } });
    const [row] = db.select().from(changeLog).where(eq(changeLog.entityId, "byw")).orderBy(desc(changeLog.id)).all();
    assert.equal(row.action, "update");
    assert.deepEqual((row.after as { config: unknown }).config, { limit: 30, mode: "server", sections: ["Films"] });
  });
});

describe("a job whose identity is a config value", () => {
  it("keeps overlays-remove's mode through a sections-only save", () => {
    seed("overlays-remove", "overlays", { mode: "remove" });
    updateJob("overlays-remove", { configPatch: { sections: ["Films"] } });
    assert.deepEqual(configOf("overlays-remove"), { mode: "remove", sections: ["Films"] });
  });

  it("keeps it even through a whole-config replace that omits it", () => {
    seed("overlays-remove", "overlays", { mode: "remove" });
    updateJob("overlays-remove", { config: { mode: "apply" } });
    assert.equal(configOf("overlays-remove").mode, "remove");
  });
});

describe("whole-config replace", () => {
  it("is validated too, stripping keys the command doesn't take", () => {
    seed("sweep", "collections-sweep");
    updateJob("sweep", { config: { dryRun: true, stale: "x" } });
    assert.deepEqual(configOf("sweep"), { dryRun: true });
    assert.throws(() => updateJob("sweep", { config: { dryRun: "yes" } }), JobConfigError);
  });
});

describe("other fields", () => {
  it("refuses to disable an always-on job", () => {
    seed("generate", "generate");
    assert.throws(() => updateJob("generate", { enabled: false }), /always on/);
  });

  it("reports an invalid schedule as a fixable error and writes nothing else", () => {
    seed("byw", "because-you-watched", { limit: 12 });
    assert.throws(() => updateJob("byw", { schedule: "every tuesday", configPatch: { limit: 5 } }), JobUpdateError);
    assert.equal(configOf("byw").limit, 12);
  });
});

describe("installing a feature", async () => {
  const { createFeatures } = await import("./features.ts");
  const { installFeature, uninstallFeature } = createFeatures(c.resolve(ServicesToken));

  it("validates the settings it installs with", () => {
    db.delete(jobs).where(eq(jobs.id, "digest")).run();
    assert.throws(() => installFeature("digest", { config: { userItemCap: 99 } }), JobConfigError);
    assert.equal(db.select().from(jobs).where(eq(jobs.id, "digest")).get(), undefined);
  });

  it("records the install and the removal in change history", async () => {
    installFeature("digest", { schedule: "", config: { minAddedItems: 3 } });
    assert.equal(configOf("digest").minAddedItems, 3);
    await uninstallFeature("digest");
    const actions = db
      .select()
      .from(changeLog)
      .where(eq(changeLog.entityId, "digest"))
      .orderBy(desc(changeLog.id))
      .all()
      .map((r) => r.action);
    assert.deepEqual(actions.slice(0, 2), ["delete", "create"]);
  });
});

describe("shared defaults", () => {
  it("the digest domain's per-user cap is the one the form shows", async () => {
    const { DEFAULT_USER_ITEM_CAP } = await import("@tinkerbell/domain.digest");
    const { DIGEST_DEFAULTS } = await import("@tinkerbell/contracts");
    assert.equal(DEFAULT_USER_ITEM_CAP, DIGEST_DEFAULTS.userItemCap);
  });
});
