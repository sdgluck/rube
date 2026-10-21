/**
 * A read-model over five tables that agree about nothing. The risk here is not
 * that a query is wrong — each one is a plain select — but that the *merge* is:
 *
 * - Every source is queried with the same `limit` and the results are then
 *   re-cut to `limit`. That is a deliberate trade (a five-way UNION with five
 *   casts per column would make adding a sixth source miserable), but it means
 *   a busy source can crowd the others out of the page. The behaviour is worth
 *   pinning so a change to it is a decision rather than a surprise.
 * - `undo` is the whole point of the page. A wrong `undo` kind either offers a
 *   button that does nothing, or hides a real one — and the only source with a
 *   genuine undo, `metadata`, has to *stop* offering it once the batch has
 *   already been reverted. `outstanding === 0` is the switch, and it is
 *   computed in SQL rather than in TypeScript, which is where it can silently
 *   become null.
 * - `since` is applied per source against five different timestamp columns.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { createTestContainer } from "@rube/composition/test-support";
import {
  cleanupCandidates,
  DbToken,
  deletedRules,
  metadataOriginals,
  overlayOriginals,
  ruleRunChanges,
  rules,
} from "@rube/db";
import { ChangesToken, type ChangeKind } from "@rube/domain.changes";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { changeFeed } = c.resolve(ChangesToken);

const RULE = "rule-a";

function seedRule(id = RULE, name = "Sci-Fi Gems"): void {
  db.insert(rules).values({ id, name, type: "collection", createdAt: 0 }).run();
}

function seedCollectionChange(at: number, itemTitle: string, change: "added" | "removed" = "removed"): void {
  db.insert(ruleRunChanges)
    .values({
      runId: "run-1",
      ruleId: RULE,
      sectionKey: "1",
      sectionTitle: "Movies",
      collectionName: "Sci-Fi Gems",
      itemRatingKey: `rk-${itemTitle}`,
      itemTitle,
      change,
      at,
    })
    .run();
}

function seedMetadataWrite(
  at: number,
  opts: { batchId: string; ratingKey: string; field: string; reverted?: boolean; title?: string },
): void {
  db.insert(metadataOriginals)
    .values({
      batchId: opts.batchId,
      ruleId: RULE,
      ratingKey: opts.ratingKey,
      sectionId: "1",
      itemTitle: opts.title ?? "Blade Runner",
      field: opts.field,
      appliedAt: at,
      revertedAt: opts.reverted ? at + 1 : null,
    })
    .run();
}

function seedCleanup(at: number | null, opts: { ratingKey: string; title: string; action: string }): void {
  db.insert(cleanupCandidates)
    .values({
      ruleId: RULE,
      ratingKey: opts.ratingKey,
      sectionId: "1",
      title: opts.title,
      firstMatchedAt: 0,
      lastMatchedAt: 0,
      actionedAt: at,
      action: opts.action,
    })
    .run();
}

function seedDeletedRule(at: number, id = "gone-1", name = "Old Rule"): void {
  db.insert(deletedRules).values({ id, name, type: "collection", createdAt: 0, deletedAt: at }).run();
}

function seedOverlay(at: number, ratingKey = "rk-overlay"): void {
  db.insert(overlayOriginals)
    .values({ ratingKey, sectionId: "1", originalPosterUrl: "http://plex/thumb/1", appliedAt: at })
    .run();
}

beforeEach(() => {
  db.delete(ruleRunChanges).run();
  db.delete(metadataOriginals).run();
  db.delete(cleanupCandidates).run();
  db.delete(deletedRules).run();
  db.delete(overlayOriginals).run();
  db.delete(rules).run();
  seedRule();
});

describe("the merged feed", () => {
  test("interleaves every source, newest first", () => {
    seedCollectionChange(100, "Arrival");
    seedMetadataWrite(200, { batchId: "b1", ratingKey: "rk1", field: "titleSort" });
    seedCleanup(300, { ratingKey: "rk2", title: "Dune", action: "delete" });
    seedDeletedRule(400);
    seedOverlay(500);

    const feed = changeFeed();

    assert.deepEqual(
      feed.map((e) => e.kind),
      ["overlay", "rule", "cleanup", "metadata", "collection"],
    );
    assert.deepEqual(
      feed.map((e) => e.at),
      [500, 400, 300, 200, 100],
    );
  });

  test("ids are unique across sources", () => {
    seedCollectionChange(100, "Arrival");
    seedMetadataWrite(200, { batchId: "b1", ratingKey: "rk1", field: "titleSort" });
    seedCleanup(300, { ratingKey: "rk2", title: "Dune", action: "delete" });

    const ids = changeFeed().map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
    // Namespaced by kind, so two sources sharing a numeric key cannot collide.
    assert.ok(ids.every((id) => /^(collection|metadata|cleanup|rule|overlay):/.test(id)));
  });

  test("`kinds` narrows to the named sources", () => {
    seedCollectionChange(100, "Arrival");
    seedCleanup(300, { ratingKey: "rk2", title: "Dune", action: "delete" });
    seedOverlay(500);

    const only: readonly ChangeKind[] = ["cleanup"];
    assert.deepEqual(
      changeFeed({ kinds: only }).map((e) => e.kind),
      ["cleanup"],
    );
  });

  test("an empty `kinds` means every kind, not none", () => {
    // The UI sends `[]` when no filter chip is selected. Reading that as "show
    // nothing" would blank the page.
    seedCollectionChange(100, "Arrival");
    seedOverlay(500);
    assert.equal(changeFeed({ kinds: [] }).length, 2);
  });

  test("`since` is applied to each source's own timestamp column", () => {
    seedCollectionChange(100, "Old");
    seedCollectionChange(900, "New");
    seedMetadataWrite(100, { batchId: "old", ratingKey: "rk1", field: "titleSort" });
    seedMetadataWrite(900, { batchId: "new", ratingKey: "rk2", field: "titleSort" });
    seedCleanup(100, { ratingKey: "rk3", title: "Old", action: "delete" });
    seedCleanup(900, { ratingKey: "rk4", title: "New", action: "delete" });
    seedDeletedRule(100, "old-rule", "Old");
    seedDeletedRule(900, "new-rule", "New");
    seedOverlay(100, "rk-old");
    seedOverlay(900, "rk-new");

    const feed = changeFeed({ since: 500 });

    assert.equal(feed.length, 5, "one survivor per source");
    assert.ok(
      feed.every((e) => e.at >= 500),
      "nothing older than `since` came through",
    );
  });

  test("`since` is inclusive of its own boundary", () => {
    seedCollectionChange(500, "Exactly");
    assert.equal(changeFeed({ since: 500 }).length, 1);
    assert.equal(changeFeed({ since: 501 }).length, 0);
  });

  test("`limit` caps the merged page, not each source", () => {
    for (let i = 0; i < 5; i++) seedCollectionChange(100 + i, `Film ${i}`);
    seedOverlay(1000);

    const feed = changeFeed({ limit: 3 });
    assert.equal(feed.length, 3);
    assert.equal(feed[0]?.kind, "overlay", "the newest still wins the cut");
  });

  test("a busy source crowds the others out — the known cost of per-source limits", () => {
    // Documenting the trade rather than blessing it: every collection change is
    // newer than the overlay, so with limit 2 the overlay never appears even
    // though it is the only row of its kind. If this ever becomes a real
    // complaint, the fix is a per-kind floor, and this test should change.
    for (let i = 0; i < 10; i++) seedCollectionChange(1000 + i, `Film ${i}`);
    seedOverlay(1);

    const feed = changeFeed({ limit: 2 });
    assert.deepEqual(
      feed.map((e) => e.kind),
      ["collection", "collection"],
    );
  });

  test("an empty install produces an empty feed rather than throwing", () => {
    db.delete(rules).run();
    assert.deepEqual(changeFeed(), []);
  });
});

describe("undo", () => {
  test("an outstanding metadata batch offers the batch undo", () => {
    seedMetadataWrite(200, { batchId: "b1", ratingKey: "rk1", field: "titleSort" });

    const entry = changeFeed()[0];
    assert.equal(entry?.undo, "metadata-batch");
    assert.equal(entry?.undoRef, "b1");
  });

  test("a fully reverted metadata batch stops offering it", () => {
    seedMetadataWrite(200, { batchId: "b1", ratingKey: "rk1", field: "titleSort", reverted: true });

    const entry = changeFeed()[0];
    assert.equal(entry?.undo, "none", "the undo has already been spent");
    assert.match(entry?.detail ?? "", /already reverted/);
  });

  test("a partly reverted batch still offers it", () => {
    // One field put back by hand, one still applied. The batch undo is what
    // finishes the job, so it has to stay on offer.
    seedMetadataWrite(200, { batchId: "b1", ratingKey: "rk1", field: "titleSort", reverted: true });
    seedMetadataWrite(201, { batchId: "b1", ratingKey: "rk1", field: "summary" });

    const entry = changeFeed()[0];
    assert.equal(entry?.undo, "metadata-batch");
  });

  test("a deleted rule offers a restore, pointed at its own id", () => {
    seedDeletedRule(400, "gone-1", "Old Rule");

    const entry = changeFeed()[0];
    assert.equal(entry?.undo, "restore-rule");
    assert.equal(entry?.undoRef, "gone-1");
  });

  test("collection, cleanup and overlay changes admit they have no undo", () => {
    seedCollectionChange(100, "Arrival");
    seedCleanup(300, { ratingKey: "rk2", title: "Dune", action: "delete" });
    seedOverlay(500);

    for (const entry of changeFeed()) {
      assert.equal(entry.undo, "none", `${entry.kind} claimed an undo it does not have`);
      assert.equal(entry.undoRef, null);
      assert.ok(entry.irreversibleNote, `${entry.kind} should say why`);
    }
  });

  test("the cleanup note is specific to the action that ran", () => {
    seedCleanup(300, { ratingKey: "rk1", title: "Dune", action: "delete" });
    seedCleanup(200, { ratingKey: "rk2", title: "Arrival", action: "unmonitor" });
    seedCleanup(100, { ratingKey: "rk3", title: "Solaris", action: "label" });

    const byTitle = new Map(changeFeed().map((e) => [e.title, e]));
    assert.match(byTitle.get("Dune")?.irreversibleNote ?? "", /file is gone/);
    assert.match(byTitle.get("Arrival")?.irreversibleNote ?? "", /Re-monitor/);
    assert.equal(byTitle.get("Solaris")?.irreversibleNote, undefined, "a label is self-evidently reversible");
  });
});

describe("presentation", () => {
  test("a metadata batch over one item is titled with that item", () => {
    seedMetadataWrite(200, { batchId: "b1", ratingKey: "rk1", field: "titleSort", title: "Blade Runner" });
    seedMetadataWrite(201, { batchId: "b1", ratingKey: "rk1", field: "summary", title: "Blade Runner" });

    const entry = changeFeed()[0];
    assert.equal(entry?.title, "Blade Runner");
    assert.equal(entry?.detail, "2 field writes");
  });

  test("a metadata batch over several items is titled with the count", () => {
    seedMetadataWrite(200, { batchId: "b1", ratingKey: "rk1", field: "titleSort" });
    seedMetadataWrite(201, { batchId: "b1", ratingKey: "rk2", field: "titleSort" });

    assert.equal(changeFeed()[0]?.title, "2 items");
  });

  test("writes are grouped into one row per batch", () => {
    seedMetadataWrite(200, { batchId: "b1", ratingKey: "rk1", field: "titleSort" });
    seedMetadataWrite(201, { batchId: "b1", ratingKey: "rk2", field: "summary" });
    seedMetadataWrite(300, { batchId: "b2", ratingKey: "rk3", field: "genre" });

    const metadata = changeFeed().filter((e) => e.kind === "metadata");
    assert.equal(metadata.length, 2);
    assert.deepEqual(
      metadata.map((e) => e.undoRef),
      ["b2", "b1"],
    );
  });

  test("a collection change reads as added or removed, and links to its run", () => {
    seedCollectionChange(100, "Arrival", "added");

    const entry = changeFeed()[0];
    assert.match(entry?.detail ?? "", /^Added to /);
    assert.equal(entry?.href, `/rules/${RULE}/runs?run=run-1`);
    assert.equal(entry?.ruleName, "Sci-Fi Gems", "the rule name is joined in");
  });

  test("deleting a rule takes its collection changes with it, leaving the tombstone", () => {
    // Worth pinning because the join in `collectionChanges` is a LEFT join,
    // which reads as though it were defending against an orphaned change — it
    // isn't, because `rule_id` cascades. What survives a rule delete is the
    // `rule` entry from the tombstone, and that is the row the user needs.
    seedDeletedRule(50, "gone-1", "Old Rule");
    db.insert(ruleRunChanges)
      .values({
        runId: "run-9",
        ruleId: RULE,
        sectionKey: "1",
        sectionTitle: "Movies",
        collectionName: "Sci-Fi Gems",
        itemRatingKey: "rk-9",
        itemTitle: "Stalker",
        change: "removed",
        at: 100,
      })
      .run();
    db.delete(rules).run();

    const feed = changeFeed();
    assert.equal(feed.filter((e) => e.kind === "collection").length, 0, "the FK cascaded");
    assert.deepEqual(
      feed.map((e) => e.undo),
      ["restore-rule"],
      "the tombstone remains, and it is the row that carries the undo",
    );
  });

  test("an unrecognised cleanup action falls back to its own name", () => {
    seedCleanup(300, { ratingKey: "rk1", title: "Dune", action: "something_new" });
    assert.equal(changeFeed()[0]?.detail, "something_new");
  });

  test("cleanup rows that have not been actioned are not changes yet", () => {
    seedCleanup(null, { ratingKey: "rk1", title: "Pending", action: "" });
    seedCleanup(300, { ratingKey: "rk2", title: "Done", action: "delete" });

    const cleanup = changeFeed().filter((e) => e.kind === "cleanup");
    assert.deepEqual(
      cleanup.map((e) => e.title),
      ["Done"],
    );
  });
});
