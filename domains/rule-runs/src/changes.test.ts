/**
 * The diff is the whole feature: everything downstream — the changeset rows,
 * the counts on the runs list, and the revert that plays them backwards — is
 * derived from it. Getting "changed" wrong in either direction is expensive:
 * a false removal makes a revert put back an item that never left, and a
 * missed one makes the run look quiet on the night it emptied a collection.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { diffMembers, groupRunChanges, type RunChangeRow } from "./changes.ts";

const item = (ratingKey: string, title = `Item ${ratingKey}`) => ({ ratingKey, title });

test("diffMembers", async (t) => {
  await t.test("reports nothing for an unchanged membership", () => {
    const members = [item("1"), item("2")];
    const diff = diffMembers(members, members);
    assert.deepEqual(diff, { added: [], removed: [] });
  });

  await t.test("a first run reports every item as added", () => {
    const diff = diffMembers([], [item("1"), item("2")]);
    assert.deepEqual(
      diff.added.map((m) => m.ratingKey),
      ["1", "2"],
    );
    assert.deepEqual(diff.removed, []);
  });

  await t.test("an emptied collection reports every item as removed", () => {
    const diff = diffMembers([item("1"), item("2")], []);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(
      diff.removed.map((m) => m.ratingKey),
      ["1", "2"],
    );
  });

  await t.test("reports both directions in one pass", () => {
    const diff = diffMembers([item("1"), item("2")], [item("2"), item("3")]);
    assert.deepEqual(
      diff.added.map((m) => m.ratingKey),
      ["3"],
    );
    assert.deepEqual(
      diff.removed.map((m) => m.ratingKey),
      ["1"],
    );
  });

  await t.test("a retitled item is not a change — Plex re-matched it, it didn't move", () => {
    const diff = diffMembers([item("1", "The Thing")], [item("1", "The Thing (1982)")]);
    assert.deepEqual(diff, { added: [], removed: [] });
  });

  await t.test("carries the title as it looked when the item moved", () => {
    const diff = diffMembers([item("1", "Old Name")], [item("2", "New Arrival")]);
    assert.equal(diff.added[0]?.title, "New Arrival");
    assert.equal(diff.removed[0]?.title, "Old Name");
  });

  await t.test("ignores ordering, which Plex does not promise to preserve", () => {
    const diff = diffMembers([item("1"), item("2")], [item("2"), item("1")]);
    assert.deepEqual(diff, { added: [], removed: [] });
  });
});

test("groupRunChanges", async (t) => {
  const row = (over: Partial<RunChangeRow>): RunChangeRow => ({
    collectionName: "Sci-Fi Gems",
    sectionKey: "1",
    sectionTitle: "Movies",
    collectionRatingKey: "900",
    itemRatingKey: "1",
    itemTitle: "Solaris",
    change: "added",
    ...over,
  });

  await t.test("splits a collection's rows into the two directions", () => {
    const groups = groupRunChanges([
      row({ itemRatingKey: "1", change: "added" }),
      row({ itemRatingKey: "2", change: "removed" }),
    ]);
    assert.equal(groups.length, 1);
    assert.deepEqual(
      groups[0]!.added.map((m) => m.ratingKey),
      ["1"],
    );
    assert.deepEqual(
      groups[0]!.removed.map((m) => m.ratingKey),
      ["2"],
    );
  });

  await t.test("keeps same-named collections in different libraries apart", () => {
    const groups = groupRunChanges([
      row({ sectionKey: "1", sectionTitle: "Movies" }),
      row({ sectionKey: "2", sectionTitle: "4K Movies" }),
    ]);
    assert.equal(groups.length, 2);
  });

  await t.test("does not let a null rating key overwrite a real one", () => {
    const groups = groupRunChanges([
      row({ itemRatingKey: "1", collectionRatingKey: "900" }),
      row({ itemRatingKey: "2", collectionRatingKey: null }),
    ]);
    assert.equal(groups[0]!.collectionRatingKey, "900");
  });

  await t.test("returns nothing for a run that changed nothing", () => {
    assert.deepEqual(groupRunChanges([]), []);
  });
});
