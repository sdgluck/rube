import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cronError,
  describeSchedule,
  dstShifts,
  formatSchedule,
  minGapMs,
  parseSchedule,
  sameSchedule,
  weekOccurrences,
  DAY_MS,
  HOUR_MS,
  INTERVAL_STEPS,
  type JobSchedule,
} from "./job-schedule.ts";

describe("parseSchedule / formatSchedule", () => {
  it("round-trips every quarter hour, daily and on a weekday set", () => {
    for (let time = 0; time < 1440; time += 15) {
      for (const s of [
        { kind: "daily", time },
        { kind: "weekly", days: [1, 3, 5], time },
        { kind: "weekly", days: [0], time },
      ] as JobSchedule[]) {
        assert.deepEqual(parseSchedule(formatSchedule(s)), s);
      }
    }
  });

  it("round-trips every interval the picker offers", () => {
    for (const unit of ["second", "minute", "hour"] as const) {
      for (const every of INTERVAL_STEPS[unit]) {
        const s: JobSchedule =
          unit === "hour" ? { kind: "interval", every, unit, offset: 0 } : { kind: "interval", every, unit };
        assert.deepEqual(parseSchedule(formatSchedule(s)), s, `${every} ${unit}`);
      }
    }
  });

  it("reads the spellings the shipped defaults use", () => {
    assert.deepEqual(parseSchedule("0 9 * * MON"), { kind: "weekly", days: [1], time: 540 });
    assert.deepEqual(parseSchedule("0 4 * * 7"), { kind: "weekly", days: [0], time: 240 });
    assert.deepEqual(parseSchedule("*/30 * * * * *"), { kind: "interval", every: 30, unit: "second" });
    assert.deepEqual(parseSchedule("0 30 1 * * *"), { kind: "daily", time: 90 });
    assert.deepEqual(parseSchedule("@daily"), { kind: "daily", time: 0 });
    assert.deepEqual(parseSchedule("0 2 * * 1-5"), { kind: "weekly", days: [1, 2, 3, 4, 5], time: 120 });
    assert.deepEqual(parseSchedule("0 2 * * 0-6"), { kind: "daily", time: 120 });
    assert.deepEqual(parseSchedule("  "), { kind: "manual" });
  });

  it("keeps anything else verbatim as custom", () => {
    for (const cron of ["*/7 * * * *", "0 5 1 * *", "0 9 * * MON#1", "0 */5 * * *", "5 * * * * *", "0 1,13 * * *"]) {
      assert.deepEqual(parseSchedule(cron), { kind: "custom", cron });
      assert.equal(formatSchedule(parseSchedule(cron)), cron);
    }
  });
});

describe("sameSchedule", () => {
  it("compares meaning, not spelling", () => {
    assert.ok(sameSchedule("0 9 * * MON", "0 9 * * 1"));
    assert.ok(sameSchedule("@daily", "0 0 * * *"));
    assert.ok(!sameSchedule("0 9 * * MON", "0 9 * * 2"));
    assert.ok(!sameSchedule("", "0 0 * * *"));
  });
});

describe("describeSchedule", () => {
  it("says it the way a person would", () => {
    assert.equal(describeSchedule(parseSchedule("")), "Manual only");
    assert.equal(describeSchedule(parseSchedule("30 1 * * *")), "Daily at 01:30");
    assert.equal(describeSchedule(parseSchedule("0 2 * * 1-5")), "Weekdays at 02:00");
    assert.equal(describeSchedule(parseSchedule("*/15 * * * *")), "Every 15 minutes");
    assert.equal(describeSchedule(parseSchedule("* * * * *")), "Every minute");
    assert.equal(describeSchedule(parseSchedule("30 */6 * * *")), "Every 6 hours at :30");
  });
});

describe("cronError", () => {
  it("accepts manual and valid crons", () => {
    assert.equal(cronError(""), null);
    assert.equal(cronError("0 1 * * *", "Europe/London"), null);
  });
  it("reports a parse failure and a schedule that never fires", () => {
    assert.match(cronError("61 * * * *") ?? "", /minute/i);
    assert.equal(cronError("0 0 31 2 *"), "never fires");
  });
});

describe("minGapMs", () => {
  it("measures each shape", () => {
    assert.equal(minGapMs(""), Infinity);
    assert.equal(minGapMs("0 1 * * *"), DAY_MS);
    assert.equal(minGapMs("0 1 * * 1,2"), DAY_MS);
    assert.equal(minGapMs("0 1 * * 0"), 7 * DAY_MS);
    assert.equal(minGapMs("0 */6 * * *"), 6 * HOUR_MS);
    assert.equal(minGapMs("*/30 * * * * *"), 30_000);
    assert.equal(minGapMs("0 1,3 * * *", "UTC"), 2 * HOUR_MS);
  });
});

describe("weekOccurrences", () => {
  it("places daily and weekly starts on the week", () => {
    assert.deepEqual(weekOccurrences("0 1 * * *")?.length, 7);
    assert.deepEqual(weekOccurrences("30 4 * * 0"), [270]);
    assert.equal(weekOccurrences("*/15 * * * *"), null);
  });
  it("walks a custom cron in the configured zone", () => {
    const from = new Date(Date.UTC(2026, 5, 7, 0, 0)); // a Sunday
    assert.deepEqual(weekOccurrences("0 1,13 * * 2", "UTC", from), [2 * 1440 + 60, 2 * 1440 + 780]);
  });
});

describe("dstShifts", () => {
  it("finds both clock changes in Europe/London", () => {
    const shifts = dstShifts("Europe/London", Date.UTC(2026, 0, 1));
    assert.deepEqual(
      shifts.map((s) => [s.kind, s.from, s.to]),
      [
        ["skipped", 60, 120],
        ["repeated", 60, 120],
      ],
    );
  });
  it("has none in UTC", () => {
    assert.deepEqual(dstShifts("UTC", Date.UTC(2026, 0, 1)), []);
  });
});
