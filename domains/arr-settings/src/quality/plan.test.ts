import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { qualityPreset, type QualityPreset, type SizeLimit } from "@rube/contracts";
import { customFormatSchemaFixture, qualityDefinitionsFixture, qualityProfileSchemaFixture } from "@rube/test-support";
import { planPreset, PlanError, sizeFormatName, type Plan, type PlanInput } from "./plan.ts";
import type { LiveQuality, WireCustomFormat, WireDefinition, WireProfile, WireSpec } from "./wire.ts";

function liveFor(service: "radarr" | "sonarr", opts: { version?: string; withoutSize?: boolean } = {}): LiveQuality {
  const version = opts.version ?? (service === "radarr" ? "5.14.0" : "4.0.10");
  const modern = !version.startsWith("3.");
  return {
    version,
    capabilities: service === "sonarr" && !modern ? ["releaseProfiles", "languageProfiles"] : ["customFormats"],
    profileSchema: qualityProfileSchemaFixture(service) as WireProfile,
    profiles: [],
    customFormats: [],
    specSchema: customFormatSchemaFixture(service, { withoutSize: opts.withoutSize }) as unknown as WireSpec[],
    definitions: qualityDefinitionsFixture(service) as unknown as WireDefinition[],
  };
}

function preset(id: string): QualityPreset {
  const p = qualityPreset(id);
  assert.ok(p, id);
  return p;
}

const HD = preset("radarr-hd-bluray-web");
const COMPACT = preset("radarr-compact-1080p");

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    service: "radarr",
    preset: HD,
    limit: HD.defaultLimit,
    target: { name: "HD" },
    live: liveFor("radarr"),
    siblings: [],
    ...overrides,
  };
}

/**
 * What the *Arr would hold after applying a plan, with ids assigned the way
 * the real thing assigns them. Lets a test plan, "apply", and plan again
 * without a server.
 */
function applyToLive(live: LiveQuality, plan: Plan): LiveQuality {
  const formats = [...live.customFormats];
  let nextFormat = Math.max(0, ...formats.map((f) => f.id ?? 0)) + 1;
  for (const step of plan.steps) {
    if (step.kind !== "customFormat") continue;
    if (step.action === "create") formats.push({ ...step.body, id: nextFormat++ });
    else formats[formats.findIndex((f) => f.id === step.id)] = step.body;
  }
  const ids = new Map(formats.map((f) => [f.name, f.id ?? 0]));

  let definitions = live.definitions;
  const defs = plan.steps.find((s) => s.kind === "definitions");
  if (defs) definitions = definitions.map((d) => defs.body.find((b) => b.id === d.id) ?? d);

  const profiles = [...live.profiles];
  for (const step of plan.steps) {
    if (step.kind !== "profile") continue;
    const body = {
      ...step.body,
      formatItems: (step.body.formatItems ?? []).map((f) => ({ ...f, format: ids.get(f.name ?? "") ?? f.format })),
    };
    if (step.action === "create") profiles.push({ ...body, id: Math.max(0, ...profiles.map((p) => p.id ?? 0)) + 1 });
    else profiles[profiles.findIndex((p) => p.id === step.id)] = body;
  }
  return { ...live, customFormats: formats as WireCustomFormat[], definitions, profiles };
}

describe("planPreset", () => {
  test("a new profile on a bare instance creates formats, sizes and the profile", () => {
    const plan = planPreset(input());
    const kinds = plan.steps.map((s) => `${s.kind}:${s.action}`);
    assert.ok(kinds.includes("definitions:update"));
    assert.equal(kinds.at(-1), "profile:create", "the profile comes last, after what it references");
    const formats = plan.steps.filter((s) => s.kind === "customFormat");
    // Every scored format, plus this profile's size ceiling.
    assert.equal(formats.length, HD.customFormats.length + 1);
    assert.ok(formats.some((s) => s.name === sizeFormatName("HD")));
  });

  test("the profile allows exactly the preset's qualities, best first, with the right cutoff", () => {
    const plan = planPreset(input());
    const profile = plan.steps.find((s) => s.kind === "profile");
    assert.ok(profile);
    assert.deepEqual(profile.after.qualities, [
      "Bluray-1080p",
      "WEB 1080p (WEBDL-1080p, WEBRip-1080p)",
      "Bluray-720p",
      "WEB 720p (WEBDL-720p, WEBRip-720p)",
    ]);
    assert.equal(profile.after.cutoff, "Bluray-1080p");
    // Every quality the instance knows is still present, disallowed.
    const count = (items: WireProfile["items"]): number =>
      (items ?? []).reduce((n, i) => n + (i.quality ? 1 : count(i.items)), 0);
    assert.equal(count(profile.body.items), 30);
    assert.equal(profile.after.scores["BR-DISK"], -10000);
    assert.equal(profile.after.scores[sizeFormatName("HD")], -10000);
  });

  test("planning again after applying is empty", () => {
    const first = planPreset(input());
    const live = applyToLive(input().live, first);
    const id = live.profiles.find((p) => p.name === "HD")?.id;
    assert.ok(id);
    const second = planPreset(input({ live, target: { profileId: id } }));
    assert.deepEqual(
      second.steps.map((s) => ({ kind: s.kind, changes: s.changes })),
      [],
    );
  });

  test("an edit made in the *Arr shows up as a profile change", () => {
    const live = applyToLive(input().live, planPreset(input()));
    const profile = live.profiles[0];
    profile.formatItems = profile.formatItems!.map((f) => (f.name === "NF" ? { ...f, score: 500 } : f));
    const plan = planPreset(input({ live, target: { profileId: profile.id! } }));
    const step = plan.steps.find((s) => s.kind === "profile");
    assert.ok(step);
    assert.deepEqual(step.changes, [{ path: "scores.NF", kind: "changed", before: 500, after: 60 }]);
  });

  test("a score on the user's own format is left alone", () => {
    const base = input().live;
    const own: WireCustomFormat = { id: 99, name: "My Language", specifications: [] };
    const live = applyToLive(
      { ...base, customFormats: [own] },
      planPreset(input({ live: { ...base, customFormats: [own] } })),
    );
    const profile = live.profiles[0];
    profile.formatItems = profile.formatItems!.map((f) => (f.name === "My Language" ? { ...f, score: 25 } : f));
    const plan = planPreset(input({ live, target: { profileId: profile.id! } }));
    assert.deepEqual(plan.steps, []);
  });

  test("an existing format of the same name is adopted, not duplicated", () => {
    const live = input().live;
    live.customFormats = [
      {
        id: 7,
        name: "LQ",
        specifications: [
          {
            name: "Old",
            implementation: "ReleaseGroupSpecification",
            negate: false,
            required: false,
            fields: [{ name: "value", value: "^(YIFY)$" }],
          },
        ],
      },
    ];
    const plan = planPreset(input({ live }));
    const lq = plan.steps.filter((s) => s.kind === "customFormat" && s.name === "LQ");
    assert.equal(lq.length, 1);
    assert.equal(lq[0].action, "update");
    assert.equal(lq[0].kind === "customFormat" && lq[0].id, 7);
  });

  test("an update keeps fields the planner does not own", () => {
    const live = applyToLive(input().live, planPreset(input()));
    const profile = live.profiles[0];
    profile.language = { id: 2, name: "French" };
    profile.formatItems = profile.formatItems!.map((f) => (f.name === "NF" ? { ...f, score: 1 } : f));
    const plan = planPreset(input({ live, target: { profileId: profile.id! } }));
    const step = plan.steps.find((s) => s.kind === "profile");
    assert.ok(step);
    assert.deepEqual(step.body.language, { id: 2, name: "French" });
  });

  test("sizes are the loosest across managed profiles", () => {
    const hd: SizeLimit = { maxGb: 15, basisMinutes: 120, ceilingGb: null };
    const compact: SizeLimit = { maxGb: 6, basisMinutes: 120, ceilingGb: null };
    const plan = planPreset(
      input({
        preset: COMPACT,
        limit: compact,
        target: { name: "Compact" },
        siblings: [{ arrProfileId: 5, preset: HD, limit: hd }],
      }),
    );
    const defs = plan.steps.find((s) => s.kind === "definitions");
    assert.ok(defs);
    // Compact alone would cap Bluray-1080p at 51.2. HD needs 128, so 128 wins.
    assert.equal(defs.after["Bluray-1080p"].max, 128);
    // The smaller minimum wins too, so compact's small encodes are admitted.
    assert.equal(defs.after["Bluray-1080p"].min, 10);
  });

  test("unmanaged profiles on the instance earn a warning", () => {
    const live = input().live;
    live.profiles = [{ id: 1, name: "Any", items: [] }];
    const plan = planPreset(input({ live }));
    assert.ok(plan.warnings.some((w) => w.includes("1 profile Rube does not manage")));
  });

  test("a limit below a quality's minimum is refused, naming the quality", () => {
    assert.throws(
      () => planPreset(input({ limit: { maxGb: 3, basisMinutes: 120, ceilingGb: null } })),
      (err: unknown) => err instanceof PlanError && /Bluray-1080p/.test(err.message),
    );
  });

  test("Sonarr v3 cannot take a preset that needs custom formats", () => {
    const sonarr = preset("sonarr-web-1080p");
    assert.throws(
      () =>
        planPreset({
          service: "sonarr",
          preset: sonarr,
          limit: sonarr.defaultLimit,
          target: { name: "TV" },
          live: liveFor("sonarr", { version: "3.0.10" }),
          siblings: [],
        }),
      (err: unknown) => err instanceof PlanError && /custom formats/.test(err.message),
    );
  });

  test("Sonarr's size ceiling applies to single episodes only", () => {
    const sonarr = preset("sonarr-web-1080p");
    const plan = planPreset({
      service: "sonarr",
      preset: sonarr,
      limit: sonarr.defaultLimit,
      target: { name: "TV" },
      live: liveFor("sonarr"),
      siblings: [],
    });
    const size = plan.steps.find((s) => s.kind === "customFormat" && s.name === sizeFormatName("TV"));
    assert.ok(size && size.kind === "customFormat");
    assert.deepEqual(
      size.body.specifications.map((s) => s.implementation),
      ["SizeSpecification", "ReleaseTypeSpecification"],
    );
  });

  test("without SizeSpecification the ceiling is skipped with a warning", () => {
    const plan = planPreset(input({ live: liveFor("radarr", { withoutSize: true }) }));
    assert.ok(!plan.steps.some((s) => s.kind === "customFormat" && s.name === sizeFormatName("HD")));
    assert.ok(plan.warnings.some((w) => w.includes("ceiling")));
  });

  test("a new profile cannot take an existing name", () => {
    const live = input().live;
    live.profiles = [{ id: 1, name: "HD", items: [] }];
    assert.throws(() => planPreset(input({ live })), PlanError);
  });

  test("the preview converts the limit into recognisable sizes", () => {
    const plan = planPreset(input());
    assert.equal(plan.sizes.mbPerMinute, 128);
    assert.deepEqual(
      plan.sizes.examples.find((e) => e.minutes === 180),
      { minutes: 180, gb: 22.5 },
    );
  });
});
