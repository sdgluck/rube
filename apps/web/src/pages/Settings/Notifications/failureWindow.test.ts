import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkIntervalMinutes, failedChecksSuffix } from "./failureWindow.ts";

describe("failedChecksSuffix", () => {
  it("multiplies by the default every-minute schedule", () => {
    assert.equal(failedChecksSuffix(5, "* * * * *"), "failed checks (≈5 min)");
    assert.equal(failedChecksSuffix(1, "* * * * *"), "failed check (≈1 min)");
  });

  it("follows a slowed schedule", () => {
    assert.equal(failedChecksSuffix(3, "*/5 * * * *"), "failed checks (≈15 min)");
  });

  it("drops the estimate when the schedule has no fixed step", () => {
    assert.equal(failedChecksSuffix(3, "0 * * * *"), "failed checks");
    assert.equal(failedChecksSuffix(3, undefined), "failed checks");
  });
});

describe("checkIntervalMinutes", () => {
  it("rejects a step on any field but minutes", () => {
    assert.equal(checkIntervalMinutes("* */2 * * *"), null);
    assert.equal(checkIntervalMinutes("*/30 * * * * *"), null);
  });
});
