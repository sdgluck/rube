import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { narrateSmartFilter, needsTagLookup } from "./smart-filter-narrate.ts";
import type { SmartFilterGroup, SmartFilterNode, SmartFilterOp } from "@rube/plex-smart-filter";

const leaf = (field: string, op: SmartFilterOp, value: string): SmartFilterNode => ({
  kind: "leaf",
  field,
  op,
  value,
});

const all = (...children: SmartFilterNode[]): SmartFilterGroup => ({ kind: "group", combinator: "all", children });
const any = (...children: SmartFilterNode[]): SmartFilterGroup => ({ kind: "group", combinator: "any", children });

const films = { noun: "films" };
const series = { noun: "series" };

describe("narrateSmartFilter", () => {
  it("writes the sentence a person would write, not the filter", () => {
    const text = narrateSmartFilter(
      all(leaf("genre", "=", "1204"), leaf("originallyAvailableAt", ">=", "-10y"), leaf("unwatched", "=", "1")),
      { ...films, resolveTag: (_f, v) => (v === "1204" ? "Horror" : v) },
    );
    assert.equal(text, "Horror films released in the last 10 years that you haven't watched.");
  });

  it("says who hasn't watched it — Plex's view state is the owner's, Rube's is everyone's", () => {
    assert.equal(
      narrateSmartFilter(all(leaf("addedAt", ">=", "-30d"), leaf("tb.watchedByNobody", "=", "1")), series),
      "Series added in the last 30 days that nobody has watched.",
    );
  });

  it("collapses an or over one field into a list", () => {
    const text = narrateSmartFilter(
      all(
        any(leaf("genre", "=", "Comedy"), leaf("genre", "=", "Romance")),
        leaf("year", ">=", "2000"),
        leaf("rating", ">=", "7"),
      ),
      films,
    );
    assert.equal(text, "Comedy and romance films from 2000 onwards, rated 7/10 or higher.");
  });

  it("puts quality adjectives before the genre", () => {
    assert.equal(
      narrateSmartFilter(
        all(leaf("genre", "=", "Horror"), leaf("resolution", "=", "4k"), leaf("hdr", "=", "1")),
        films,
      ),
      "4K HDR horror films.",
    );
  });

  it("hangs credits off the noun", () => {
    assert.equal(
      narrateSmartFilter(all(leaf("director", "=", "Christopher Nolan"), leaf("unwatched", "=", "1")), films),
      "Films directed by Christopher Nolan that you haven't watched.",
    );
  });

  it("keeps watch-history clauses honest about who they mean", () => {
    assert.equal(
      narrateSmartFilter(all(leaf("tb.abandonedPct", "<", "20"), leaf("tb.lastPlayedAt", "<=", "-1y")), films),
      "Films abandoned below 20%, last played by anyone more than 1 year ago.",
    );
  });

  it("falls back to a relative clause for fields it has no phrasing for", () => {
    assert.equal(
      narrateSmartFilter(all(leaf("mediaBitrate", ">=", "8000")), films),
      "Films whose bitrate is at least 8000 kbps.",
    );
  });

  it("refuses a tree whose precedence a flat sentence would lose", () => {
    // A top-level `or` across different fields: "horror, or anything added
    // this week" is not "horror films added this week".
    assert.equal(narrateSmartFilter(any(leaf("genre", "=", "Horror"), leaf("addedAt", ">=", "-7d")), films), null);
    // And a group nested inside an `or` branch.
    assert.equal(
      narrateSmartFilter(
        any(all(leaf("genre", "=", "Horror"), leaf("year", ">=", "2000")), leaf("hdr", "=", "1")),
        films,
      ),
      null,
    );
  });

  it("ignores clauses with no value yet", () => {
    assert.equal(narrateSmartFilter(all(leaf("genre", "=", "Horror"), leaf("year", ">=", "")), films), "Horror films.");
    assert.equal(narrateSmartFilter(all(leaf("year", ">=", "")), films), null);
  });

  it("never produces a hole, a doubled space, or a missing full stop", () => {
    const fields = [
      ["genre", "=", "Horror"],
      ["contentRating", "=", "PG"],
      ["network", "=", "HBO"],
      ["collection", "=", "Halloween"],
      ["label", "=", "keep"],
      ["decade", "=", "1980"],
      ["duration", ">", "7200000"],
      ["userRating", ">=", "8"],
      ["audienceRating", "<=", "4"],
      ["viewCount", "=", "0"],
      ["tb.playCount", ">=", "3"],
      ["tb.watchedByAll", "=", "1"],
      ["tb.watchedBy", "=", "Sam"],
      ["inProgress", "=", "1"],
      ["trash", "=", "0"],
      ["duplicate", "=", "1"],
      ["unmatched", "=", "1"],
      ["title", "=", "Alien"],
      ["summary", "=", "space"],
      ["originallyAvailableAt", "=", "1999"],
      ["addedAt", "<", "2020-01-01"],
      ["lastViewedAt", ">=", "-2w"],
      ["show.genre", "=", "Drama"],
      ["episode.unwatched", "=", "1"],
    ] as const;

    for (const [field, op, value] of fields) {
      const text = narrateSmartFilter(all(leaf(field, op, value)), films);
      assert.ok(text, `${field}: no sentence`);
      assert.ok(!/\s{2}/.test(text), `${field}: doubled space in "${text}"`);
      assert.ok(!/\s[.,]/.test(text), `${field}: space before punctuation in "${text}"`);
      assert.ok(text.endsWith("."), `${field}: no full stop in "${text}"`);
      assert.ok(!text.includes("?"), `${field}: unfilled value in "${text}"`);
    }
  });

  it("treats a show-scoped tag as the item's own, and an episode-scoped one as its own thing", () => {
    assert.equal(narrateSmartFilter(all(leaf("show.genre", "=", "Drama")), series), "Drama series.");
    assert.equal(
      narrateSmartFilter(all(leaf("episode.unwatched", "=", "1")), series),
      "Series whose episode unplayed is Yes.",
    );
  });
});

describe("needsTagLookup", () => {
  it("only asks Plex about values that are bare keys", () => {
    assert.equal(needsTagLookup("genre", "1204"), true);
    assert.equal(needsTagLookup("genre", "Horror"), false);
    assert.equal(needsTagLookup("year", "2000"), false);
    // Resolution codes are ours to spell out — "4k" needs no server round-trip.
    assert.equal(needsTagLookup("resolution", "4k"), false);
  });
});
