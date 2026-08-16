import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPresetFilter, CLEANUP_PRESETS, cleanupPreset, presetFromFilter } from "./cleanup-presets.ts";
import type { SmartFilterGroup } from "./types.ts";

describe("cleanup presets", () => {
  it("recovers every preset and its knob from the tree it built", () => {
    // The round-trip is the whole contract: nothing about the preset is saved,
    // so a rule reopens as a preset only if the shape still matches.
    for (const preset of CLEANUP_PRESETS) {
      const found = presetFromFilter(buildPresetFilter(preset, preset.knobDefault));
      assert.equal(found?.preset.value, preset.value);
      assert.equal(found?.amount, preset.knobDefault);
    }
  });

  it("keeps the knob the user set, not the default", () => {
    const stale = cleanupPreset("stale");
    assert.ok(stale);
    assert.equal(presetFromFilter(buildPresetFilter(stale, 42))?.amount, 42);
  });

  it("writes days as a rolling offset, so the rule doesn't age into a fixed date", () => {
    const stale = cleanupPreset("stale");
    assert.ok(stale);
    const tree = buildPresetFilter(stale, 365);
    assert.deepEqual(tree.children[0], {
      kind: "leaf",
      field: "tb.lastPlayedAt",
      op: "<",
      value: "-365d",
    });
  });

  it("stops claiming a hand-edited tree", () => {
    const never = cleanupPreset("never_watched");
    assert.ok(never);
    const edited = buildPresetFilter(never, 180);
    // One more clause than the preset writes — this is now the user's filter.
    edited.children.push({
      kind: "leaf",
      field: "genre",
      op: "=",
      value: "Documentary",
    });
    assert.equal(presetFromFilter(edited), null);
  });

  it("stops claiming a tree whose date was switched to an exact day", () => {
    const never = cleanupPreset("never_watched");
    assert.ok(never);
    const edited = buildPresetFilter(never, 180);
    const dateLeaf = edited.children[1];
    assert.ok(dateLeaf && dateLeaf.kind === "leaf");
    dateLeaf.value = "2024-01-31";
    assert.equal(presetFromFilter(edited), null);
  });

  it("claims nothing from an OR tree — a preset only ever writes AND", () => {
    const abandoned = cleanupPreset("abandoned");
    assert.ok(abandoned);
    const tree: SmartFilterGroup = {
      ...buildPresetFilter(abandoned, 20),
      combinator: "any",
    };
    assert.equal(presetFromFilter(tree), null);
  });

  it("claims nothing from an empty filter", () => {
    assert.equal(presetFromFilter({ kind: "group", combinator: "all", children: [] }), null);
  });
});
