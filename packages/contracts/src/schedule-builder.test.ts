/**
 * Two promises worth pinning. The builder never shows a cron it would change
 * by saving (parse → format is the identity on everything it accepts), and
 * what it writes means what its description says — checked against croner,
 * which is what actually fires, rather than against our own reading of cron.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Cron } from "croner";
import {
  ALL_MONTHS,
  builderError,
  describeBuilder,
  formatBuilder,
  parseBuilder,
  type BuilderSchedule,
} from "./schedule-builder.ts";

function next(cron: string, count: number, from = "2027-01-04T00:00:00Z"): string[] {
  return new Cron(cron, { timezone: "UTC", paused: true })
    .nextRuns(count, new Date(from))
    .map((d) => d.toISOString().slice(0, 16));
}

describe("parseBuilder", () => {
  const ACCEPTED: Array<[string, string]> = [
    ["30 2 * * *", "Every day at 02:30"],
    ["30 2,14 * * *", "Every day at 02:30 and 14:30"],
    ["0,30 2 * * *", "Every day at 02:00 and 02:30"],
    ["0 9 * * 1-5", "Weekdays at 09:00"],
    ["0 9 * * MON,WED", "Mon, Wed at 09:00"],
    ["0 3 1,15 * *", "On the 1st and 15th at 03:00"],
    ["0 3 L * *", "On the last day at 03:00"],
    ["0 3 1,L * *", "On the 1st and last day at 03:00"],
    ["0 3 * * 5#L", "On the last Friday at 03:00"],
    ["0 3 * * 2#2", "On the second Tuesday at 03:00"],
    ["*/15 9-17 * * 1-5", "Weekdays every 15 minutes from 09:00 to 17:45"],
    ["*/30 22-23,0-5 * * *", "Every day every 30 minutes from 22:00 to 05:30"],
    ["0 8-20/5 * * *", "Every day every 5 hours from 08:00 to 18:00"],
    ["15 */6 * * *", "Every day every 6 hours at :15"],
    ["0 4 * 12 *", "Every day at 04:00, in December"],
    ["0 4 1 1,7 *", "On the 1st at 04:00, in January and July"],
    ["@monthly", "On the 1st at 00:00"],
    ["0 30 2 * * *", "Every day at 02:30"],
  ];

  for (const [cron, text] of ACCEPTED) {
    it(`reads "${cron}"`, () => {
      const parsed = parseBuilder(cron);
      assert.ok(parsed, "should parse");
      assert.equal(describeBuilder(parsed), text);
    });
  }

  it("refuses what it can't show without changing", () => {
    for (const cron of [
      "",
      "5,35 2,14 * * *", // two minutes crossed with two hours
      "0 3 L * 5", // dom and dow both set: cron ORs them
      "*/7 * * * *", // not an even split of the hour
      "*/10 * * * * *", // sub-minute
      "0 22-23,0-5/2 * * *", // a stepped window across midnight
      "0 3 ? * *",
      "not cron",
    ]) {
      assert.equal(parseBuilder(cron), null, cron);
    }
  });
});

describe("formatBuilder", () => {
  it("is the identity on its own output", () => {
    for (const cron of [
      "30 2,14 * * *",
      "0 9 * * 1-5",
      "0 3 1,15,L * *",
      "0 3 * * 5#L",
      "*/15 9-17 * * 1-5",
      "*/30 22-23,0-5 * * *",
      "0 8-20/5 * * *",
      "0 4 1 1,7 *",
    ]) {
      const parsed = parseBuilder(cron)!;
      assert.equal(formatBuilder(parsed), cron);
      assert.deepEqual(parseBuilder(formatBuilder(parsed)), parsed);
    }
  });

  it("fires when it says it will", () => {
    const s = (patch: Partial<BuilderSchedule>): string =>
      formatBuilder({ time: { kind: "at", times: [180] }, days: { kind: "every" }, months: ALL_MONTHS, ...patch });

    assert.deepEqual(next(s({ days: { kind: "nth", nth: "last", day: 5 } }), 2), [
      "2027-01-29T03:00",
      "2027-02-26T03:00",
    ]);
    assert.deepEqual(next(s({ days: { kind: "month", dates: [15], last: true } }), 3), [
      "2027-01-15T03:00",
      "2027-01-31T03:00",
      "2027-02-15T03:00",
    ]);
    assert.deepEqual(next(s({ months: [3] }), 1), ["2027-03-01T03:00"]);
    assert.deepEqual(
      next(
        formatBuilder({
          time: { kind: "repeat", every: 30, unit: "minute", from: 23, to: 0, minute: 0 },
          days: { kind: "every" },
          months: ALL_MONTHS,
        }),
        5,
        "2027-01-04T12:00:00Z",
      ),
      ["2027-01-04T23:00", "2027-01-04T23:30", "2027-01-05T00:00", "2027-01-05T00:30", "2027-01-05T23:00"],
    );
  });
});

describe("builderError", () => {
  it("explains a set of times cron can't express", () => {
    const s: BuilderSchedule = {
      time: { kind: "at", times: [150, 855] },
      days: { kind: "every" },
      months: ALL_MONTHS,
    };
    assert.match(builderError(s) ?? "", /share their minutes/);
    assert.equal(builderError({ ...s, time: { kind: "at", times: [150, 870] } }), null);
  });

  it("refuses an empty choice", () => {
    const base: BuilderSchedule = { time: { kind: "at", times: [] }, days: { kind: "every" }, months: ALL_MONTHS };
    assert.match(builderError(base) ?? "", /at least one time/);
    assert.match(
      builderError({ ...base, time: { kind: "at", times: [60] }, days: { kind: "month", dates: [], last: false } }) ??
        "",
      /at least one date/,
    );
  });
});
