import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseLogLine, stampLog } from "./run-log.ts";

const T1 = Date.UTC(2026, 9, 14, 18, 3, 59, 123);
const T2 = T1 + 600_000;

describe("stampLog", () => {
  test("prefixes each line with when it was written", () => {
    assert.equal(stampLog("one\ntwo", T1), "2026-10-14T18:03:59.123Z one\n2026-10-14T18:03:59.123Z two");
  });

  test("leaves a line that already has a time alone", () => {
    // A buffered block stamped as it happened, flushed ten minutes later.
    const buffered = stampLog("started", T1);
    assert.equal(stampLog(buffered, T2), buffered);
  });

  test("keeps blank lines blank", () => {
    assert.equal(stampLog("\n--- Rule ---", T1), "\n2026-10-14T18:03:59.123Z --- Rule ---");
  });
});

describe("parseLogLine", () => {
  test("splits a stamped line into its time and text", () => {
    assert.deepEqual(parseLogLine("2026-10-14T18:03:59.123Z hello world"), { at: T1, text: "hello world" });
  });

  test("reads a line from before stamping as text only", () => {
    assert.deepEqual(parseLogLine('Created "Horror" (12 items)'), { text: 'Created "Horror" (12 items)' });
  });

  test("doesn't mistake a date inside the text for a stamp", () => {
    assert.deepEqual(parseLogLine("since 2026-10-14T18:03:59.123Z nothing changed"), {
      text: "since 2026-10-14T18:03:59.123Z nothing changed",
    });
  });
});
