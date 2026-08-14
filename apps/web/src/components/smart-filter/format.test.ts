import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fieldLabel, LOCAL_FIELD_DEFS } from "@tinkerbell/contracts";
import { describeCondition, formatFilterValue, parseRelativeDate, toRelativeDate } from "./format.ts";
import { opsFor, opLabel, withFallbackOp } from "./ops.ts";

/**
 * These strings are the whole point of the smart-filter UI: what the user
 * reads instead of `duration = 7200000`. Both editors and three summaries
 * render through them, so the phrasing is pinned here rather than left to be
 * spot-checked in the browser.
 */
describe("formatFilterValue", () => {
  it("spells durations out in hours and minutes", () => {
    assert.equal(formatFilterValue("duration", "7200000"), "2h 0m");
    assert.equal(formatFilterValue("duration", "5400000"), "1h 30m");
    assert.equal(formatFilterValue("duration", "2700000"), "45m");
  });

  it("renders booleans as Yes / No", () => {
    assert.equal(formatFilterValue("unwatched", "1"), "Yes");
    assert.equal(formatFilterValue("unwatched", "0"), "No");
    assert.equal(formatFilterValue("hdr", "true"), "Yes");
  });

  it("renders relative dates as a span, not an offset", () => {
    assert.equal(formatFilterValue("addedAt", "-30d"), "30 days ago");
    assert.equal(formatFilterValue("addedAt", "-1w"), "1 week ago");
    assert.equal(formatFilterValue("lastViewedAt", "-3mon"), "3 months ago");
    assert.equal(formatFilterValue("originallyAvailableAt", "-2y"), "2 years ago");
  });

  it("carries units and rating scales", () => {
    assert.equal(formatFilterValue("mediaBitrate", "30000"), "30000 kbps");
    assert.equal(formatFilterValue("audienceRating", "8"), "8/10");
    assert.equal(formatFilterValue("year", "1999"), "1999");
  });

  it("prefers a resolved tag title over the stored key", () => {
    assert.equal(formatFilterValue("genre", "5840", "Horror"), "Horror");
    // Unresolved, the numeric key is all we have — but never invent a name.
    assert.equal(formatFilterValue("genre", "5840"), "5840");
  });

  it("marks an unset value rather than rendering an empty clause", () => {
    assert.equal(formatFilterValue("genre", ""), "?");
  });
});

describe("relative date round-trip", () => {
  it("parses and re-emits Plex offsets unchanged", () => {
    for (const raw of ["-30d", "-2w", "-3mon", "-1y"]) {
      const parsed = parseRelativeDate(raw);
      assert.ok(parsed, `${raw} should parse`);
      assert.equal(toRelativeDate(parsed.amount, parsed.unit), raw);
    }
  });

  it("rejects anything that isn't an offset", () => {
    assert.equal(parseRelativeDate("2024-01-31"), null);
    assert.equal(parseRelativeDate("30d"), null);
    assert.equal(parseRelativeDate(""), null);
  });
});

describe("describeCondition", () => {
  it("phrases a bounded relative date as a window", () => {
    assert.equal(describeCondition("addedAt", ">=", ["-30d"]), "Date added in the last 30 days");
    assert.equal(describeCondition("addedAt", "<", ["-1y"]), "Date added more than 1 year ago");
  });

  it("falls back to operator phrasing for exact dates", () => {
    assert.equal(describeCondition("year", ">=", ["2000"]), "Year is at least 2000");
  });

  it("joins multi-value clauses", () => {
    assert.equal(describeCondition("genre", "=", ["1", "2"], ["Horror", "Thriller"]), "Genre is Horror, Thriller");
  });
});

describe("opsFor", () => {
  it("labels the same operator to suit the field", () => {
    assert.equal(opLabel("year", ">="), "is at least");
    assert.equal(opLabel("addedAt", ">="), "is on or after");
    assert.equal(opLabel("duration", ">"), "is longer than");
    assert.equal(opLabel("genre", "="), "is");
    assert.equal(opLabel("title", "="), "contains");
  });

  it("offers booleans a single operator", () => {
    assert.deepEqual(
      opsFor("unwatched").map((o) => o.op),
      ["="],
    );
  });

  it("keeps an imported operator the field doesn't normally offer", () => {
    const ops = withFallbackOp(opsFor("unwatched"), "!=");
    assert.ok(ops.some((o) => o.op === "!="));
  });
});

describe("fieldLabel", () => {
  it("uses the curated label where there is one", () => {
    assert.equal(fieldLabel("originallyAvailableAt"), "Release date");
    assert.equal(fieldLabel("unviewedLeafCount"), "Unplayed episodes");
  });

  it("splits camelCase for fields Plex has and we don't enumerate", () => {
    assert.equal(fieldLabel("audioLanguage"), "Audio language");
  });

  it("spells a scope prefix out rather than leaking it", () => {
    assert.equal(fieldLabel("show.network"), "Show network");
    assert.equal(fieldLabel("episode.originallyAvailableAt"), "Episode release date");
    assert.equal(fieldLabel("show.audioLanguage"), "Show audio language");
  });

  it("types a scoped field from its base", () => {
    // `show.unwatchedLeaves` used to fall through to "string", which offered
    // "contains" as its operator and left the value unformatted.
    assert.equal(describeCondition("episode.unwatched", "=", ["1"]), "Episode unplayed is Yes");
    assert.equal(
      describeCondition("episode.originallyAvailableAt", ">=", ["-5y"]),
      "Episode release date in the last 5 years",
    );
  });
});

/**
 * Watch-history fields are the ones most likely to read as machine output —
 * they're the only fields whose key isn't a Plex field name, so a miss shows
 * up as a literal `tb.` in the summary chips.
 */
describe("describeCondition — watch-history fields", () => {
  it("reads the boolean pair as sentences, not label-is-Yes", () => {
    assert.equal(describeCondition("tb.watchedByAll", "=", ["1"]), "Watched by everyone");
    assert.equal(describeCondition("tb.watchedByAll", "=", ["0"]), "Not watched by everyone");
    assert.equal(describeCondition("tb.watchedByAll", "!=", ["1"]), "Not watched by everyone");
    assert.equal(describeCondition("tb.watchedByNobody", "=", ["1"]), "Watched by nobody");
    assert.equal(describeCondition("tb.watchedByNobody", "=", ["0"]), "Watched by someone");
  });

  it("names the user when one has been resolved", () => {
    assert.equal(describeCondition("tb.watchedBy", "=", ["42"], ["Sam"]), "Watched by Sam");
    assert.equal(describeCondition("tb.watchedBy", "!=", ["42"], ["Sam"]), "Not watched by Sam");
    // Unresolved ids are labelled rather than shown bare.
    assert.equal(describeCondition("tb.watchedBy", "=", ["42"]), "Watched by user 42");
  });

  it("phrases the abandonment threshold in the direction the operator implies", () => {
    assert.equal(describeCondition("tb.abandonedPct", "<", ["20"]), "Abandoned below 20%");
    assert.equal(describeCondition("tb.abandonedPct", ">=", ["80"]), "Watched past 80%");
  });

  it("lets the generic path handle the fields it already reads well", () => {
    assert.equal(describeCondition("tb.playCount", ">=", ["3"]), "Plays (all users) is at least 3");
    assert.equal(describeCondition("tb.lastPlayedAt", ">=", ["-30d"]), "Last played (any user) in the last 30 days");
  });

  it("no local field falls through to the camelCase fallback", () => {
    for (const def of LOCAL_FIELD_DEFS) {
      const text = describeCondition(def.field, "=", ["1"]);
      assert.ok(!text.includes("tb."), `"${def.field}" rendered as "${text}"`);
      assert.ok(!text.startsWith("Tb"), `"${def.field}" rendered as "${text}"`);
    }
  });
});
