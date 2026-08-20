import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sortReleases, releaseAge, rejectionSummary, protocolLabel, type ReleaseRow } from "./releases.ts";

const row = (over: Partial<ReleaseRow> & { guid: string }): ReleaseRow => ({ title: over.guid, ...over });

describe("sortReleases", () => {
  test("orders by custom format score, highest first", () => {
    const sorted = sortReleases([row({ guid: "a", customFormatScore: 10 }), row({ guid: "b", customFormatScore: 90 })]);
    assert.deepEqual(
      sorted.map((r) => r.guid),
      ["b", "a"],
    );
  });

  test("breaks a score tie on seeders, then size", () => {
    const sorted = sortReleases([
      row({ guid: "small", seeders: 5, size: 1 }),
      row({ guid: "big", seeders: 5, size: 100 }),
      row({ guid: "seeded", seeders: 50, size: 1 }),
    ]);
    assert.deepEqual(
      sorted.map((r) => r.guid),
      ["seeded", "big", "small"],
    );
  });

  /**
   * Overriding the *Arr's refusal is why an interactive search exists, so a
   * rejected release sinks rather than vanishing.
   */
  test("rejected releases sink below accepted ones, whatever their score", () => {
    const sorted = sortReleases([
      row({ guid: "rejected", customFormatScore: 1000, rejected: true }),
      row({ guid: "fine", customFormatScore: 0 }),
    ]);
    assert.deepEqual(
      sorted.map((r) => r.guid),
      ["fine", "rejected"],
    );
  });

  test("does not mutate its input", () => {
    const input = [row({ guid: "a", customFormatScore: 1 }), row({ guid: "b", customFormatScore: 2 })];
    sortReleases(input);
    assert.deepEqual(
      input.map((r) => r.guid),
      ["a", "b"],
    );
  });

  test("a missing score sorts as zero rather than throwing the order out", () => {
    const sorted = sortReleases([row({ guid: "none" }), row({ guid: "negative", customFormatScore: -50 })]);
    assert.deepEqual(
      sorted.map((r) => r.guid),
      ["none", "negative"],
    );
  });
});

describe("releaseAge", () => {
  test("gets coarser as it gets older", () => {
    assert.equal(releaseAge(0.5), "<1h");
    assert.equal(releaseAge(5), "5h");
    assert.equal(releaseAge(23.9), "23h");
    assert.equal(releaseAge(24), "1d");
    assert.equal(releaseAge(24 * 29), "29d");
    assert.equal(releaseAge(24 * 30), "1mo");
    assert.equal(releaseAge(24 * 300), "10mo");
    assert.equal(releaseAge(24 * 365), "1y");
  });

  test("an age the indexer didn't report is a dash, not a zero", () => {
    assert.equal(releaseAge(undefined), "—");
    assert.equal(releaseAge(-1), "—");
    assert.equal(releaseAge(Number.NaN), "—");
  });
});

describe("rejectionSummary", () => {
  test("nothing rejected is null", () => {
    assert.equal(rejectionSummary(undefined), null);
    assert.equal(rejectionSummary([]), null);
  });

  test("one reason reads as itself", () => {
    assert.equal(rejectionSummary(["Not a preferred word"]), "Not a preferred word");
  });

  test("the rest are counted, not hidden", () => {
    assert.equal(rejectionSummary(["Too big", "Wrong language", "Unknown quality"]), "Too big (+2 more)");
  });
});

describe("protocolLabel", () => {
  test("names the two the *Arrs speak", () => {
    assert.equal(protocolLabel("usenet"), "Usenet");
    assert.equal(protocolLabel("torrent"), "Torrent");
  });

  test("passes anything else through rather than inventing a label", () => {
    assert.equal(protocolLabel("unknown"), "unknown");
    assert.equal(protocolLabel(undefined), "—");
  });
});
