/**
 * Twenty-five collisions between the same two rules are one problem. The
 * failure this guards is the banner going back to a wall of identical
 * sentences — or, the other way, merging conflicts that need separate fixes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { groupConflicts, type ConflictLike } from "./conflictGroups.ts";

const A = { id: "a", name: "Streaming services" };
const B = { id: "b", name: "Streaming (imported)" };
const C = { id: "c", name: "Directors" };
const FILMS = { key: "1", title: "Films" };

const named = (subject: string, rules = [A, B], library = FILMS): ConflictLike => ({
  kind: "collection-name",
  rules,
  subject,
  detail: `Both build a collection called "${subject}"`,
  library,
});

test("groupConflicts", async (t) => {
  await t.test("collisions between the same rules in one library are one entry", () => {
    const groups = groupConflicts([named("Netflix"), named("Hulu"), named("HBO")]);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].subjects, ["Netflix", "Hulu", "HBO"]);
    assert.deepEqual(groups[0].rules, [A, B]);
  });

  await t.test("a different pair of rules is a different entry", () => {
    const groups = groupConflicts([named("Netflix"), named("Woody Allen", [B, C]), named("Hulu")]);
    assert.deepEqual(
      groups.map((g) => g.subjects),
      [["Netflix", "Hulu"], ["Woody Allen"]],
    );
  });

  await t.test("the same rules in another library are fixed separately", () => {
    const groups = groupConflicts([named("Netflix"), named("Netflix", [A, B], { key: "2", title: "TV" })]);
    assert.equal(groups.length, 2);
  });

  await t.test("other kinds keep a sentence each", () => {
    // Each names a different item, and merging them would lose which.
    const queued = (title: string): ConflictLike => ({
      kind: "cleanup-vs-collection",
      rules: [A, C],
      subject: title,
      detail: `"${title}" is queued for removal`,
    });
    assert.equal(groupConflicts([queued("Heat"), queued("Alien")]).length, 2);
  });
});
