/**
 * 574 lines with no tests, and the risky part is the ordering.
 *
 * `overlay_configs` carries a unique index on (section, position, order), so a
 * reorder cannot simply write the new numbers — halfway through, two rows would
 * momentarily share one. Both `moveOverlayConfig` and `reorderOverlayConfigs`
 * dodge that by parking every touched row on a negative order first and then
 * renumbering. It works, and it is the kind of thing that keeps working only
 * because nothing changed: an early return, a reordered loop, or a stray
 * `.limit()` turns it into a UNIQUE constraint crash or, worse, a silently
 * reshuffled badge stack.
 *
 * The other things here that had no cover:
 *
 * - `replaceOverlayConfigs` deletes a section's whole configuration before
 *   reinserting. It is one transaction, so a failure must leave the old
 *   configuration intact rather than an empty section.
 * - `deletePreset` refuses to delete a built-in. That guard is one `if`, and
 *   the built-ins are re-seeded on boot, so a regression would look like "my
 *   custom preset vanished and a stock one came back".
 * - `evaluateRule` is pure, trivially testable, and gates every badge that gets
 *   burned into a poster. A wrong `hideIfMissing` writes a badge reading
 *   `undefined` onto somebody's artwork.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";
import { createTestContainer } from "@rube/composition/test-support";
import { DbToken, overlayConfigs, overlayPresets } from "@rube/db";
import { evaluateRule, OverlaysToken, type OverlayPosition } from "@rube/domain.overlays";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const overlays = c.resolve(OverlaysToken);

const SECTION = "1";
const TOP: OverlayPosition = "top-left";
const BOTTOM: OverlayPosition = "bottom-right";

beforeEach(() => {
  db.delete(overlayConfigs).run();
});

/** The stack in a position, as `overlayType` in order. */
function stack(position: OverlayPosition, sectionId = SECTION): string[] {
  return db
    .select()
    .from(overlayConfigs)
    .where(and(eq(overlayConfigs.sectionId, sectionId), eq(overlayConfigs.position, position)))
    .all()
    .sort((a, b) => a.order - b.order)
    .map((r) => r.overlayType);
}

function orders(position: OverlayPosition, sectionId = SECTION): number[] {
  return db
    .select()
    .from(overlayConfigs)
    .where(and(eq(overlayConfigs.sectionId, sectionId), eq(overlayConfigs.position, position)))
    .all()
    .map((r) => r.order)
    .sort((a, b) => a - b);
}

function add(overlayType: string, position: OverlayPosition = TOP, sectionId = SECTION): number {
  return overlays.addOverlayConfig({ sectionId, position, overlayType: overlayType as never }).id;
}

describe("addOverlayConfig", () => {
  test("appends to the end of its own stack", () => {
    add("resolution");
    add("hdr");
    add("edition");
    assert.deepEqual(stack(TOP), ["resolution", "hdr", "edition"]);
    assert.deepEqual(orders(TOP), [0, 1, 2]);
  });

  test("orders are per position, so two stacks both start at zero", () => {
    add("resolution", TOP);
    add("hdr", BOTTOM);
    assert.deepEqual(orders(TOP), [0]);
    assert.deepEqual(orders(BOTTOM), [0]);
  });

  test("orders are per section too", () => {
    add("resolution", TOP, "1");
    add("resolution", TOP, "2");
    assert.deepEqual(orders(TOP, "1"), [0]);
    assert.deepEqual(orders(TOP, "2"), [0]);
  });

  test("a gap left by a delete is not reused, and that is fine", () => {
    // `max(order) + 1`, not `count`. Reusing a freed number would collide with
    // whatever is still sitting on it after a middle delete.
    const a = add("resolution");
    add("hdr");
    overlays.removeOverlayConfigById(a);
    add("edition");
    assert.deepEqual(orders(TOP), [1, 2]);
  });

  test("style and rule round-trip through their JSON columns", () => {
    const row = overlays.addOverlayConfig({
      sectionId: SECTION,
      position: TOP,
      overlayType: "imdb_rating",
      style: { shape: "pill" } as never,
      rule: { minImdb: 7.5 },
    });
    const read = overlays.getOverlayConfig(row.id);
    assert.equal(read?.rule?.minImdb, 7.5);
    assert.equal(read?.style?.shape, "pill");
  });

  test("a corrupt style column reads as null rather than throwing", () => {
    // `safeParseJson` exists for rows written by an older schema. A throw here
    // would take out the whole Overlays page rather than one badge.
    const id = add("resolution");
    db.update(overlayConfigs).set({ style: "{not json" }).where(eq(overlayConfigs.id, id)).run();
    assert.equal(overlays.getOverlayConfig(id)?.style, null);
  });
});

describe("reorderOverlayConfigs", () => {
  test("applies the given order", () => {
    const a = add("resolution");
    const b = add("hdr");
    const d = add("edition");

    overlays.reorderOverlayConfigs(SECTION, TOP, [d, a, b]);

    assert.deepEqual(stack(TOP), ["edition", "resolution", "hdr"]);
    assert.deepEqual(orders(TOP), [0, 1, 2]);
  });

  test("reordering to the identical order is a no-op, not a constraint crash", () => {
    // The case the negative-tmp dance exists for: every row keeps its number,
    // so a naive implementation collides with itself on the first write.
    const a = add("resolution");
    const b = add("hdr");
    const d = add("edition");

    assert.doesNotThrow(() => overlays.reorderOverlayConfigs(SECTION, TOP, [a, b, d]));

    assert.deepEqual(stack(TOP), ["resolution", "hdr", "edition"]);
    assert.deepEqual(orders(TOP), [0, 1, 2]);
  });

  test("a full reversal leaves no duplicate orders", () => {
    const ids = ["resolution", "hdr", "edition", "studio", "runtime"].map((t) => add(t));

    overlays.reorderOverlayConfigs(SECTION, TOP, [...ids].reverse());

    assert.deepEqual(stack(TOP), ["runtime", "studio", "edition", "hdr", "resolution"]);
    assert.deepEqual(orders(TOP), [0, 1, 2, 3, 4]);
  });

  test("a swap of two adjacent rows works", () => {
    const a = add("resolution");
    const b = add("hdr");
    overlays.reorderOverlayConfigs(SECTION, TOP, [b, a]);
    assert.deepEqual(stack(TOP), ["hdr", "resolution"]);
  });

  test("ids from another section are ignored", () => {
    // The `sectionId` in the where-clause. Without it, a drag on one library's
    // page would renumber another library's stack.
    const mine = add("resolution", TOP, "1");
    const theirs = add("hdr", TOP, "2");

    overlays.reorderOverlayConfigs("1", TOP, [theirs, mine]);

    assert.deepEqual(stack(TOP, "2"), ["hdr"]);
    assert.deepEqual(orders(TOP, "2"), [0], "the other section was untouched");
    assert.deepEqual(stack(TOP, "1"), ["resolution"]);
  });
});

describe("moveOverlayConfig", () => {
  test("moves within a stack and renumbers", () => {
    const a = add("resolution");
    add("hdr");
    add("edition");

    overlays.moveOverlayConfig(a, TOP, 2);

    assert.deepEqual(stack(TOP), ["hdr", "edition", "resolution"]);
    assert.deepEqual(orders(TOP), [0, 1, 2]);
  });

  test("moves to the front", () => {
    add("resolution");
    add("hdr");
    const d = add("edition");

    overlays.moveOverlayConfig(d, TOP, 0);

    assert.deepEqual(stack(TOP), ["edition", "resolution", "hdr"]);
  });

  test("moves into the middle", () => {
    add("resolution");
    add("hdr");
    const d = add("edition");

    overlays.moveOverlayConfig(d, TOP, 1);

    assert.deepEqual(stack(TOP), ["resolution", "edition", "hdr"]);
  });

  test("an out-of-range target is clamped rather than leaving a hole", () => {
    const a = add("resolution");
    add("hdr");

    overlays.moveOverlayConfig(a, TOP, 99);
    assert.deepEqual(stack(TOP), ["hdr", "resolution"]);
    assert.deepEqual(orders(TOP), [0, 1]);

    overlays.moveOverlayConfig(a, TOP, -5);
    assert.deepEqual(stack(TOP), ["resolution", "hdr"]);
    assert.deepEqual(orders(TOP), [0, 1]);
  });

  test("moving across positions renumbers both stacks", () => {
    // The interesting one: the source stack has to close its gap, and the
    // target has to open one, in a single transaction without ever holding two
    // rows on the same (position, order).
    const a = add("resolution", TOP);
    add("hdr", TOP);
    add("edition", TOP);
    add("studio", BOTTOM);
    add("runtime", BOTTOM);

    overlays.moveOverlayConfig(a, BOTTOM, 1);

    assert.deepEqual(stack(TOP), ["hdr", "edition"]);
    assert.deepEqual(orders(TOP), [0, 1], "the source closed its gap");
    assert.deepEqual(stack(BOTTOM), ["studio", "resolution", "runtime"]);
    assert.deepEqual(orders(BOTTOM), [0, 1, 2]);
  });

  test("moving to an empty position works", () => {
    const a = add("resolution", TOP);
    overlays.moveOverlayConfig(a, BOTTOM, 0);
    assert.deepEqual(stack(TOP), []);
    assert.deepEqual(stack(BOTTOM), ["resolution"]);
  });

  test("moving an id that does not exist is a no-op", () => {
    add("resolution");
    assert.doesNotThrow(() => overlays.moveOverlayConfig(9999, BOTTOM, 0));
    assert.deepEqual(stack(TOP), ["resolution"]);
  });

  test("moving does not disturb another section", () => {
    const a = add("resolution", TOP, "1");
    add("hdr", TOP, "2");

    overlays.moveOverlayConfig(a, BOTTOM, 0);

    assert.deepEqual(stack(TOP, "2"), ["hdr"]);
  });
});

describe("replaceOverlayConfigs", () => {
  test("swaps a section's whole configuration", () => {
    add("resolution", TOP);
    add("hdr", TOP);

    overlays.replaceOverlayConfigs(SECTION, [
      { position: BOTTOM, overlayType: "studio" as never },
      { position: BOTTOM, overlayType: "runtime" as never },
    ]);

    assert.deepEqual(stack(TOP), []);
    assert.deepEqual(stack(BOTTOM), ["studio", "runtime"]);
  });

  test("assigns sequential orders per position", () => {
    overlays.replaceOverlayConfigs(SECTION, [
      { position: TOP, overlayType: "resolution" as never },
      { position: BOTTOM, overlayType: "studio" as never },
      { position: TOP, overlayType: "hdr" as never },
    ]);

    assert.deepEqual(orders(TOP), [0, 1]);
    assert.deepEqual(orders(BOTTOM), [0]);
  });

  test("honours an explicit order within a position", () => {
    overlays.replaceOverlayConfigs(SECTION, [
      { position: TOP, overlayType: "resolution" as never, order: 5 },
      { position: TOP, overlayType: "hdr" as never, order: 1 },
    ]);

    assert.deepEqual(stack(TOP), ["hdr", "resolution"]);
    assert.deepEqual(orders(TOP), [0, 1], "renumbered densely from the given order");
  });

  test("replacing with nothing empties the section", () => {
    add("resolution", TOP);
    overlays.replaceOverlayConfigs(SECTION, []);
    assert.deepEqual(stack(TOP), []);
  });

  test("leaves other sections alone", () => {
    add("resolution", TOP, "1");
    add("hdr", TOP, "2");

    overlays.replaceOverlayConfigs("1", [{ position: TOP, overlayType: "studio" as never }]);

    assert.deepEqual(stack(TOP, "2"), ["hdr"]);
  });

  test("a failure mid-replace rolls back rather than leaving the section empty", () => {
    // The delete happens first. Without the transaction, a bad config in the
    // middle of the list would wipe the user's overlays and put nothing back.
    add("resolution", TOP);
    add("hdr", TOP);

    assert.throws(() =>
      overlays.replaceOverlayConfigs(SECTION, [
        { position: TOP, overlayType: "studio" as never },
        // `position` is NOT NULL, so this row fails the insert.
        { position: null as never, overlayType: "runtime" as never },
      ]),
    );

    assert.deepEqual(stack(TOP), ["resolution", "hdr"], "the original configuration survived");
  });
});

describe("clearOverlayConfigs", () => {
  test("clears one section only", () => {
    add("resolution", TOP, "1");
    add("hdr", BOTTOM, "1");
    add("studio", TOP, "2");

    overlays.clearOverlayConfigs("1");

    assert.deepEqual(stack(TOP, "1"), []);
    assert.deepEqual(stack(BOTTOM, "1"), []);
    assert.deepEqual(stack(TOP, "2"), ["studio"]);
  });
});

describe("presets", () => {
  beforeEach(() => {
    db.delete(overlayPresets).run();
  });

  test("a saved preset comes back in the list", () => {
    const id = overlays.savePreset({
      name: "Mine",
      description: "d",
      data: { configs: [{ position: TOP, overlayType: "resolution" }] } as never,
    });

    const found = overlays.listPresets().find((p) => p.id === id);
    assert.equal(found?.name, "Mine");
    assert.equal(found?.builtIn, false);
  });

  test("saving under an existing id edits rather than duplicates", () => {
    const id = overlays.savePreset({ name: "First", data: { configs: [] } as never });
    overlays.savePreset({ id, name: "Second", data: { configs: [] } as never });

    const mine = overlays.listPresets().filter((p) => !p.builtIn);
    assert.equal(mine.length, 1);
    assert.equal(mine[0]?.name, "Second");
  });

  test("built-ins sort first, then by name", () => {
    overlays.ensureBuiltInPresets();
    overlays.savePreset({ name: "AAA user", data: { configs: [] } as never });

    const list = overlays.listPresets();
    const firstUserIndex = list.findIndex((p) => !p.builtIn);
    assert.ok(firstUserIndex > 0, "at least one built-in came first");
    assert.ok(list.slice(0, firstUserIndex).every((p) => p.builtIn));
  });

  test("a preset whose data no longer parses is skipped, not fatal", () => {
    // Same reasoning as the corrupt style column: one bad row must not take out
    // the list the user needs in order to delete it.
    const id = overlays.savePreset({ name: "Broken", data: { configs: [] } as never });
    db.update(overlayPresets).set({ data: '{"configs":"not-an-array"}' }).where(eq(overlayPresets.id, id)).run();

    assert.doesNotThrow(() => overlays.listPresets());
    assert.equal(
      overlays.listPresets().some((p) => p.id === id),
      false,
    );
  });

  test("a built-in cannot be deleted", () => {
    overlays.ensureBuiltInPresets();
    const builtIn = overlays.listPresets().find((p) => p.builtIn)!;

    overlays.deletePreset(builtIn.id);

    assert.ok(
      overlays.listPresets().some((p) => p.id === builtIn.id),
      "the built-in survived",
    );
  });

  test("a user preset can be deleted", () => {
    const id = overlays.savePreset({ name: "Mine", data: { configs: [] } as never });
    overlays.deletePreset(id);
    assert.equal(
      overlays.listPresets().some((p) => p.id === id),
      false,
    );
  });

  test("deleting something that does not exist is a no-op", () => {
    assert.doesNotThrow(() => overlays.deletePreset("nope"));
  });

  test("ensureBuiltInPresets is idempotent and refreshes in place", () => {
    overlays.ensureBuiltInPresets();
    const first = overlays.listPresets().filter((p) => p.builtIn);
    overlays.ensureBuiltInPresets();
    const second = overlays.listPresets().filter((p) => p.builtIn);

    assert.equal(second.length, first.length, "re-seeding did not duplicate");
    assert.deepEqual(
      second.map((p) => p.id),
      first.map((p) => p.id),
    );
  });

  test("re-seeding restores a built-in a user edited", () => {
    // Built-ins ship with the app version, so an edit to one is overwritten on
    // the next boot by design.
    overlays.ensureBuiltInPresets();
    const builtIn = overlays.listPresets().find((p) => p.builtIn)!;
    db.update(overlayPresets).set({ name: "Tampered" }).where(eq(overlayPresets.id, builtIn.id)).run();

    overlays.ensureBuiltInPresets();

    assert.equal(overlays.listPresets().find((p) => p.id === builtIn.id)?.name, builtIn.name);
  });
});

describe("evaluateRule", () => {
  const noRatings = {};

  test("no rule means show it", () => {
    assert.equal(evaluateRule(null, "resolution", "4K", noRatings), true);
    assert.equal(evaluateRule(undefined, "resolution", "4K", noRatings), true);
  });

  test("hideIfMissing suppresses a badge with no value", () => {
    // The failure it prevents: a badge reading `undefined` burned onto a
    // poster, which is not something you can take back without re-uploading
    // every affected image.
    assert.equal(evaluateRule({ hideIfMissing: true }, "resolution", null, noRatings), false);
    assert.equal(evaluateRule({ hideIfMissing: true }, "resolution", "4K", noRatings), true);
  });

  test("without hideIfMissing a null value is left to the renderer", () => {
    assert.equal(evaluateRule({ minImdb: 9 }, "imdb_rating", null, noRatings), true);
  });

  test("minImdb only gates the imdb badge", () => {
    assert.equal(evaluateRule({ minImdb: 7 }, "imdb_rating", "x", { imdbRating: "8.1" }), true);
    assert.equal(evaluateRule({ minImdb: 7 }, "imdb_rating", "x", { imdbRating: "6.9" }), false);
    // The same rule attached to a different badge type must not gate it.
    assert.equal(evaluateRule({ minImdb: 7 }, "resolution", "4K", { imdbRating: "6.9" }), true);
  });

  test("minImdb is inclusive at the boundary", () => {
    assert.equal(evaluateRule({ minImdb: 7 }, "imdb_rating", "x", { imdbRating: "7" }), true);
    assert.equal(evaluateRule({ minImdb: 7 }, "imdb_rating", "x", { imdbRating: "7.0" }), true);
  });

  test("an unparseable or absent imdb rating fails the threshold", () => {
    // Fail closed: a missing rating is not evidence that the film is good.
    for (const rating of [undefined, null, "", "N/A", "tbd"]) {
      assert.equal(evaluateRule({ minImdb: 7 }, "imdb_rating", "x", { imdbRating: rating }), false, `${rating}`);
    }
  });

  test("minRt understands the percent sign", () => {
    assert.equal(evaluateRule({ minRt: 80 }, "rt_rating", "x", { rtRating: "92%" }), true);
    assert.equal(evaluateRule({ minRt: 80 }, "rt_rating", "x", { rtRating: "79%" }), false);
    assert.equal(evaluateRule({ minRt: 80 }, "rt_rating", "x", { rtRating: "80" }), true);
  });

  test("onlyResolutions filters the resolution badge", () => {
    assert.equal(evaluateRule({ onlyResolutions: ["4K"] }, "resolution", "4K", noRatings), true);
    assert.equal(evaluateRule({ onlyResolutions: ["4K"] }, "resolution", "1080p", noRatings), false);
    assert.equal(
      evaluateRule({ onlyResolutions: [] }, "resolution", "4K", noRatings),
      false,
      "an empty list allows nothing",
    );
  });

  test("onlyResolutions does not gate other badge types", () => {
    assert.equal(evaluateRule({ onlyResolutions: ["4K"] }, "hdr", "HDR10", noRatings), true);
  });

  test("several conditions must all pass", () => {
    const rule = { minImdb: 7, hideIfMissing: true };
    assert.equal(evaluateRule(rule, "imdb_rating", "x", { imdbRating: "8" }), true);
    assert.equal(evaluateRule(rule, "imdb_rating", null, { imdbRating: "8" }), false);
    assert.equal(evaluateRule(rule, "imdb_rating", "x", { imdbRating: "5" }), false);
  });
});
