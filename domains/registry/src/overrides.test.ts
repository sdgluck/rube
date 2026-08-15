import { test } from "node:test";
import assert from "node:assert/strict";
import { applyImportOverrides, carryOverUserChoices } from "./overrides.ts";

const PUBLISHED = { pinToHomepage: true, pinRotationCount: 10 };

test("no overrides leaves the published config untouched", () => {
  assert.deepEqual(applyImportOverrides("directors", PUBLISHED, {}), PUBLISHED);
  assert.deepEqual(applyImportOverrides("directors", PUBLISHED, undefined), PUBLISHED);
});

test("unpinning applies to every rule in the pack, not just grouped ones", () => {
  assert.deepEqual(applyImportOverrides("directors", PUBLISHED, { pinToHomepage: false }), {
    pinToHomepage: false,
  });
  assert.deepEqual(applyImportOverrides("smart_filter", { pinToHomepage: false }, { pinToHomepage: false }), {
    pinToHomepage: false,
  });
});

test("unpinning drops the now-meaningless rotation count", () => {
  const out = applyImportOverrides("directors", PUBLISHED, { pinToHomepage: false, pinRotationCount: 5 });
  assert.ok(!("pinRotationCount" in out));
});

test("pinning is not forced onto single-collection rules", () => {
  const out = applyImportOverrides("smart_filter", { pinToHomepage: false }, { pinToHomepage: true });
  assert.equal(out.pinToHomepage, false);
});

test("rotation count is editable for grouped rules", () => {
  const out = applyImportOverrides("directors", PUBLISHED, { pinToHomepage: true, pinRotationCount: 3 });
  assert.deepEqual(out, { pinToHomepage: true, pinRotationCount: 3 });
});

test("limit and minItems apply to library-grouped rules", () => {
  const out = applyImportOverrides("directors", PUBLISHED, { limit: 25, minItems: 3 });
  assert.equal(out.limit, 25);
  assert.equal(out.minItems, 3);
});

test("limit is left alone where it's a TMDb fetch budget", () => {
  const out = applyImportOverrides("tmdb_franchises", { ...PUBLISHED, limit: 25 }, { limit: 5, minItems: 2 });
  assert.equal(out.limit, 25, "franchises keep the pack's fetch budget");
  assert.equal(out.minItems, 2, "but still take a min-items floor");
});

test("a pin floor applies to any rule that pins, grouped or not", () => {
  assert.equal(applyImportOverrides("directors", PUBLISHED, { pinMinItems: 5 }).pinMinItems, 5);
  assert.equal(
    applyImportOverrides("smart_filter", { pinToHomepage: true }, { pinMinItems: 5 }).pinMinItems,
    5,
    "a two-title smart filter is as thin a homepage row as a two-film director",
  );
});

test("a pin floor is not written into an unpinned rule", () => {
  const out = applyImportOverrides("directors", PUBLISHED, { pinToHomepage: false, pinMinItems: 5 });
  assert.ok(!("pinMinItems" in out));
  assert.ok(!("pinMinItems" in applyImportOverrides("smart_filter", { pinToHomepage: false }, { pinMinItems: 5 })));
});

test("unpinning drops a pin floor the pack shipped", () => {
  const out = applyImportOverrides("directors", { ...PUBLISHED, pinMinItems: 3 }, { pinToHomepage: false });
  assert.ok(!("pinMinItems" in out));
});

test("an update keeps a pin floor the user changed, and one they cleared", () => {
  assert.equal(carryOverUserChoices({ pinMinItems: 8 }, { ...PUBLISHED, pinMinItems: 3 }).pinMinItems, 8);
  assert.ok(!("pinMinItems" in carryOverUserChoices({}, { ...PUBLISHED, pinMinItems: 3 })));
});

test("an update keeps the pinning choice made at import", () => {
  const current = { sections: ["Films"], pinToHomepage: false };
  const out = carryOverUserChoices(current, { ...PUBLISHED, sections: ["Films"] });
  assert.equal(out.pinToHomepage, false);
  assert.ok(!("pinRotationCount" in out), "a rule the user unpinned doesn't get a rotation count back");
});

test("an update keeps a rotation count the user changed", () => {
  const out = carryOverUserChoices({ pinToHomepage: true, pinRotationCount: 3 }, PUBLISHED);
  assert.equal(out.pinRotationCount, 3);
});

test("an update keeps caps the user set, and absences they left", () => {
  assert.equal(carryOverUserChoices({ limit: 25 }, { minItems: 5 }).limit, 25);
  // The pack starting to ship a floor doesn't impose one on an existing rule.
  assert.ok(!("minItems" in carryOverUserChoices({ limit: 25 }, { minItems: 5 })));
});

test("an update still refreshes everything else", () => {
  const out = carryOverUserChoices(
    { smartFilter: { old: true }, pinToHomepage: false },
    { smartFilter: { fresh: true }, sections: ["Films"], pinToHomepage: true, pinRotationCount: 10 },
  );
  assert.deepEqual(out.smartFilter, { fresh: true });
  assert.deepEqual(out.sections, ["Films"]);
});

test("limit and minItems are not written into rules that can't use them", () => {
  const out = applyImportOverrides("smart_filter", { pinToHomepage: false }, { limit: 25, minItems: 3 });
  assert.ok(!("limit" in out));
  assert.ok(!("minItems" in out));
});
