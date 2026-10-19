import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { daysInMonth, formatMonthDay, parseMonthDay } from "./month-day.ts";

describe("month-day", () => {
  it("round-trips a stored window date", () => {
    for (const value of ["01-01", "02-29", "10-31", "12-25"]) {
      assert.equal(formatMonthDay(parseMonthDay(value)), value);
    }
  });

  it("pads single digits", () => {
    assert.equal(formatMonthDay({ month: 3, day: 7 }), "03-07");
  });

  it("clamps the day to the month rather than producing an invalid date", () => {
    assert.equal(formatMonthDay({ month: 4, day: 31 }), "04-30");
    assert.equal(formatMonthDay({ month: 2, day: 31 }), "02-29");
    assert.deepEqual(parseMonthDay("06-31"), { month: 6, day: 30 });
  });

  it("falls back to 1 January for anything unparseable", () => {
    assert.deepEqual(parseMonthDay(""), { month: 1, day: 1 });
    assert.deepEqual(parseMonthDay("13-01"), { month: 1, day: 1 });
    assert.deepEqual(parseMonthDay("Oct 1"), { month: 1, day: 1 });
  });

  it("knows February is 29 days in a year-less window", () => {
    assert.equal(daysInMonth(2), 29);
    assert.equal(daysInMonth(12), 31);
  });
});
