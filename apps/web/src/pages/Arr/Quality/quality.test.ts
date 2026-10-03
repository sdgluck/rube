import { test } from "node:test";
import assert from "node:assert/strict";
import { asStatus, basisLabel, formatChangeValue, sizeExamples, stepHeading, withMaxGb } from "./quality.ts";

test("a two-hour basis reads as a film, a one-hour basis as TV", () => {
  assert.equal(basisLabel(120), "per 2-hour film");
  assert.equal(basisLabel(60), "per hour of TV");
  assert.equal(basisLabel(45), "per 45 minutes");
});

test("examples scale with runtime and stop at the ceiling", () => {
  assert.deepEqual(sizeExamples({ maxGb: 15, basisMinutes: 120, ceilingGb: null }), [
    { minutes: 90, gb: 11.3 },
    { minutes: 120, gb: 15 },
    { minutes: 180, gb: 22.5 },
  ]);
  assert.equal(sizeExamples({ maxGb: 15, basisMinutes: 120, ceilingGb: 19 }).at(-1)?.gb, 19);
});

test("an untouched ceiling follows the limit, a touched one only moves when overtaken", () => {
  const limit = { maxGb: 15, basisMinutes: 120, ceilingGb: 19 };
  assert.equal(withMaxGb(limit, 20, false).ceilingGb, 25);
  assert.equal(withMaxGb(limit, 12, true).ceilingGb, 19);
  assert.equal(withMaxGb(limit, 30, true).ceilingGb, 30);
  assert.equal(withMaxGb({ ...limit, ceilingGb: null }, 30, false).ceilingGb, null);
});

test("an unknown status from a newer server reads as not checked", () => {
  assert.equal(asStatus("in_sync"), "in_sync");
  assert.equal(asStatus("something_new"), "unknown");
});

test("plan steps and values read as sentences", () => {
  assert.equal(stepHeading({ kind: "profile", action: "create", name: "HD" }), "Create profile “HD”");
  assert.equal(stepHeading({ kind: "definitions", action: "update" }), "Quality sizes (instance-wide)");
  assert.equal(formatChangeValue(["Bluray-1080p", "WEB 1080p"]), "Bluray-1080p › WEB 1080p");
  assert.equal(formatChangeValue({ min: 10, max: 128 }), "min: 10, max: 128");
  assert.equal(formatChangeValue(undefined), "—");
});
