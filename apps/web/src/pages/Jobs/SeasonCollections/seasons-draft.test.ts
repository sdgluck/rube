import { test } from "node:test";
import assert from "node:assert/strict";
import { SEASON_PRESETS } from "@rube/contracts";
import { customKey, draftDirty, draftFromConfig, patchFromDraft, presetFor } from "./seasons-draft.ts";

test("an untouched draft saves nothing", () => {
  assert.deepEqual(patchFromDraft(draftFromConfig({})), { seasons: null, customSeasons: null });
  assert.equal(draftDirty(draftFromConfig({}), {}), false);
});

test("only the fields that differ from the preset are stored", () => {
  const draft = draftFromConfig({});
  draft[0] = { ...draft[0], enabled: false, activeTo: "12-31" };
  assert.deepEqual(patchFromDraft(draft).seasons, {
    christmas: { enabled: false, activeFrom: "12-01", activeTo: "12-31" },
  });
});

test("setting a field back to the preset's value stops storing it", () => {
  const stored = { seasons: { christmas: { name: "Xmas" } } };
  const draft = draftFromConfig(stored);
  assert.equal(draftDirty(draft, stored), false);
  draft[0] = { ...draft[0], name: "Christmas" };
  assert.equal(patchFromDraft(draft).seasons, null);
  assert.equal(draftDirty(draft, stored), true);
});

test("reset gives back the shipped preset", () => {
  const preset = presetFor("halloween")!;
  assert.equal(preset.name, "Halloween");
  assert.deepEqual(
    preset.keywords.map((k) => k.id),
    SEASON_PRESETS[1].keywords.map((k) => k.id),
  );
  assert.equal(presetFor("custom-x"), undefined);
});

test("custom seasons round-trip, and an enabled one doesn't store `enabled`", () => {
  const custom = {
    key: "custom-easter",
    name: "Easter",
    activeFrom: "03-29",
    activeTo: "04-06",
    keywords: [{ id: 9921, name: "easter" }],
  };
  const draft = draftFromConfig({ customSeasons: [custom] });
  assert.deepEqual(patchFromDraft(draft).customSeasons, [custom]);
});

test("customKey slugs the name and avoids keys already used", () => {
  assert.equal(customKey("Diwali!", []), "custom-diwali");
  assert.equal(customKey("Diwali", ["custom-diwali"]), "custom-diwali-2");
  assert.equal(customKey("✨", []), "custom-season");
});
