import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeTimeRange } from "./timeRange.ts";

describe("describeTimeRange", () => {
  it("marks an end before the start as the next day", () => {
    assert.equal(describeTimeRange("23:00", "07:00"), "→ 07:00 next day · 8 h");
  });

  it("leaves a same-day range alone", () => {
    assert.equal(describeTimeRange("01:00", "06:30"), "→ 06:30 · 5 h 30 min");
  });

  it("shows sub-hour lengths in minutes", () => {
    assert.equal(describeTimeRange("23:45", "00:15"), "→ 00:15 next day · 30 min");
  });

  it("calls equal times empty, as the server does", () => {
    assert.equal(describeTimeRange("03:00", "03:00"), "Start and end match — never active");
  });

  it("returns null for a time it can't parse", () => {
    assert.equal(describeTimeRange("", "07:00"), null);
    assert.equal(describeTimeRange("25:00", "07:00"), null);
  });
});
