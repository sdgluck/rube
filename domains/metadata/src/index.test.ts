/**
 * The ledger is the only thing standing between a bad rule and permanently
 * lost hand-curated metadata, so it is tested against a real migrated database
 * rather than a fake — the aggregation is expressed in SQL, and a fake would
 * be testing the fake.
 */
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";

setupTempDb("tinkerbell-metadata-test-");

const { db, metadataOriginals } = await import("@tinkerbell/db");
const { snapshotWrites, batchRows, markReverted, listBatches, itemHistory, decodeTags, pruneOlderThan } =
  await import("./index.ts");

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

function scalar(ratingKey: string, field: string, previous: string | null, next: string, locked = false) {
  return {
    ratingKey,
    sectionId: "1",
    sectionType: "movie",
    itemTitle: `Film ${ratingKey}`,
    field,
    fieldKind: "scalar" as const,
    previousValue: previous,
    previousLocked: locked,
    newValue: next,
  };
}

beforeEach(() => {
  db.delete(metadataOriginals).run();
});

describe("snapshotWrites", () => {
  test("records the previous value and its lock state", () => {
    snapshotWrites("batch-1", "rule-1", [scalar("10", "titleSort", "The Matrix", "Matrix, The", true)], T0);

    const [row] = batchRows("batch-1");
    assert.equal(row.previousValue, "The Matrix");
    assert.equal(row.newValue, "Matrix, The");
    // Restoring the text while leaving the lock set would hand back a field
    // Plex has stopped maintaining — a revert that isn't one.
    assert.equal(row.previousLocked, 1);
    assert.equal(row.ruleId, "rule-1");
  });

  test("keeps an unset field distinguishable from an empty one", () => {
    snapshotWrites("batch-1", null, [scalar("10", "tagline", null, "Free your mind")], T0);

    assert.equal(batchRows("batch-1")[0].previousValue, null);
  });

  test("round-trips a tag set through JSON", () => {
    snapshotWrites(
      "batch-1",
      null,
      [
        {
          ...scalar("10", "genre", null, ""),
          fieldKind: "tag" as const,
          previousValue: ["Action", "Sci-Fi"],
          newValue: ["Action", "Sci-Fi", "Cyberpunk"],
        },
      ],
      T0,
    );

    const [row] = batchRows("batch-1");
    assert.deepEqual(decodeTags(row.previousValue), ["Action", "Sci-Fi"]);
    assert.deepEqual(decodeTags(row.newValue), ["Action", "Sci-Fi", "Cyberpunk"]);
  });

  test("does nothing when given no snapshots", () => {
    snapshotWrites("batch-1", null, [], T0);
    assert.equal(batchRows("batch-1").length, 0);
  });
});

describe("batchRows", () => {
  test("returns the batch newest write first, so a double write unwinds fully", () => {
    // A rule covering two sections can touch one item twice. Reverting in
    // application order would restore the value written *between* the two,
    // not the one that was there before either.
    snapshotWrites("batch-1", null, [scalar("10", "studio", "Warner", "WB")], T0);
    snapshotWrites("batch-1", null, [scalar("10", "studio", "WB", "Warner Bros.")], T0 + 1000);

    const rows = batchRows("batch-1");
    assert.deepEqual(
      rows.map((r) => r.previousValue),
      ["WB", "Warner"],
    );
  });

  test("omits rows that have already been handed back", () => {
    snapshotWrites(
      "batch-1",
      null,
      [scalar("10", "studio", "Warner", "WB"), scalar("11", "studio", "A24", "A24 Films")],
      T0,
    );
    const rows = batchRows("batch-1");
    markReverted([rows[0].id], T0 + 1000);

    // Undoing twice must be a no-op, not a double-revert.
    assert.deepEqual(
      batchRows("batch-1").map((r) => r.id),
      [rows[1].id],
    );
  });

  test("does not leak rows from another batch", () => {
    snapshotWrites("batch-1", null, [scalar("10", "studio", "Warner", "WB")], T0);
    snapshotWrites("batch-2", null, [scalar("11", "studio", "A24", "A24 Films")], T0);

    assert.equal(batchRows("batch-1").length, 1);
  });
});

describe("markReverted", () => {
  test("tolerates an empty list", () => {
    markReverted([]);
  });

  test("handles more ids than SQLite's parameter ceiling", () => {
    const snaps = Array.from({ length: 1200 }, (_, i) => scalar(String(i), "studio", "Old", "New"));
    snapshotWrites("big", null, snaps, T0);
    const ids = batchRows("big").map((r) => r.id);

    markReverted(ids, T0 + 1000);

    assert.equal(batchRows("big").length, 0);
  });
});

describe("listBatches", () => {
  test("summarises each batch newest first", () => {
    snapshotWrites("older", "rule-1", [scalar("10", "studio", "Warner", "WB")], T0);
    snapshotWrites(
      "newer",
      "rule-2",
      [scalar("11", "titleSort", null, "Matrix, The"), scalar("11", "contentRating", "US:R", "R")],
      T0 + DAY,
    );

    const batches = listBatches();
    assert.deepEqual(
      batches.map((b) => b.batchId),
      ["newer", "older"],
    );
    assert.equal(batches[0].writes, 2);
    assert.equal(batches[0].items, 1, "two fields on one item is one item");
    assert.deepEqual(batches[0].fields.sort(), ["contentRating", "titleSort"]);
    assert.deepEqual(batches[0].sampleTitles, ["Film 11"]);
  });

  test("marks a batch reverted only once every row is handed back", () => {
    snapshotWrites(
      "batch-1",
      null,
      [scalar("10", "studio", "Warner", "WB"), scalar("11", "studio", "A24", "A24 Films")],
      T0,
    );
    const rows = batchRows("batch-1");

    markReverted([rows[0].id], T0 + 1000);
    assert.equal(listBatches()[0].reverted, false, "a partial revert is not a revert");

    markReverted([rows[1].id], T0 + 2000);
    assert.equal(listBatches()[0].reverted, true);
  });
});

describe("itemHistory", () => {
  test("returns everything written to one item, newest first", () => {
    snapshotWrites("batch-1", null, [scalar("10", "studio", "Warner", "WB")], T0);
    snapshotWrites("batch-2", null, [scalar("10", "titleSort", null, "Matrix, The")], T0 + DAY);
    snapshotWrites("batch-2", null, [scalar("11", "studio", "A24", "A24 Films")], T0 + DAY);

    assert.deepEqual(
      itemHistory("10").map((r) => r.field),
      ["titleSort", "studio"],
    );
  });
});

describe("pruneOlderThan", () => {
  test("drops batches past the window and leaves the rest", () => {
    snapshotWrites("old", null, [scalar("10", "studio", "Warner", "WB")], T0);
    snapshotWrites("recent", null, [scalar("11", "studio", "A24", "A24 Films")], T0 + 100 * DAY);

    assert.equal(pruneOlderThan(T0 + 90 * DAY), 1);
    assert.deepEqual(
      listBatches().map((b) => b.batchId),
      ["recent"],
    );
  });
});

describe("decodeTags", () => {
  test("reads a corrupt row as an empty set rather than throwing", () => {
    // One unparseable row must not block the revert of every other row in
    // its batch.
    assert.deepEqual(decodeTags("{not json"), []);
    assert.deepEqual(decodeTags(null), []);
    assert.deepEqual(decodeTags('["Action", 7]'), ["Action"]);
  });
});
