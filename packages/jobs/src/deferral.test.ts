/**
 * The window maths gates every heavy job on the server. Getting it wrong in
 * the permissive direction is a nuisance; getting it wrong in the restrictive
 * direction stops the nightly work silently, which is the failure nobody
 * notices for a week.
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { createDeferral, isDeferrable, parseClock } from "./deferral.ts";

const c = createTestContainer();
after(() => c.dispose());

const { isWithinWindow } = createDeferral(c.resolve(ServicesToken));

const at = (hours: number, minutes = 0) => new Date(2026, 0, 15, hours, minutes);

test("parseClock", async (t) => {
  await t.test("reads a 24-hour time", () => {
    assert.equal(parseClock("00:00"), 0);
    assert.equal(parseClock("09:30"), 570);
    assert.equal(parseClock("23:59"), 1439);
  });

  await t.test("accepts a single-digit hour", () => {
    assert.equal(parseClock("9:30"), 570);
  });

  await t.test("rejects anything that isn't a time", () => {
    assert.equal(parseClock("24:00"), null);
    assert.equal(parseClock("12:60"), null);
    assert.equal(parseClock("noon"), null);
    assert.equal(parseClock(""), null);
  });
});

test("isWithinWindow", async (t) => {
  await t.test("a daytime window", () => {
    assert.equal(isWithinWindow("01:00", "06:00", at(3)), true);
    assert.equal(isWithinWindow("01:00", "06:00", at(0, 59)), false);
    assert.equal(isWithinWindow("01:00", "06:00", at(7)), false);
  });

  await t.test("the start is inclusive and the end is not", () => {
    // Otherwise a 01:00–06:00 window and an 06:00–09:00 one would both claim
    // 06:00, and a job scheduled on the hour would fall into both.
    assert.equal(isWithinWindow("01:00", "06:00", at(1)), true);
    assert.equal(isWithinWindow("01:00", "06:00", at(6)), false);
  });

  await t.test("a window that spans midnight is the common case, not an empty one", () => {
    assert.equal(isWithinWindow("22:00", "06:00", at(23)), true);
    assert.equal(isWithinWindow("22:00", "06:00", at(2)), true);
    assert.equal(isWithinWindow("22:00", "06:00", at(12)), false);
  });

  await t.test("an unparseable window fails open", () => {
    // A typo in a time field must not silently stop every heavy job.
    assert.equal(isWithinWindow("nonsense", "06:00", at(12)), true);
    assert.equal(isWithinWindow("22:00", "", at(12)), true);
  });

  await t.test("a zero-width window is always open, not never", () => {
    assert.equal(isWithinWindow("03:00", "03:00", at(15)), true);
  });

  await t.test("reads the clock in the configured zone, not the container's", () => {
    // The bug this covers: a UTC container configured for Los Angeles enforced
    // "overnight" eight hours out, holding jobs back all evening and releasing
    // them mid-afternoon. 03:00 UTC is 19:00 the previous day in LA.
    const utcEarlyMorning = new Date(Date.UTC(2027, 0, 15, 3, 0));
    assert.equal(isWithinWindow("01:00", "06:00", utcEarlyMorning, "UTC"), true);
    assert.equal(isWithinWindow("01:00", "06:00", utcEarlyMorning, "America/Los_Angeles"), false);
    assert.equal(isWithinWindow("18:00", "23:00", utcEarlyMorning, "America/Los_Angeles"), true);
  });
});

test("isDeferrable", async (t) => {
  await t.test("covers the jobs that render, transcode or walk the library", () => {
    assert.equal(isDeferrable("generate"), true);
    assert.equal(isDeferrable("overlays"), true);
    assert.equal(isDeferrable("preroll-process"), true);
  });

  await t.test("leaves the cheap and the time-critical alone", () => {
    // Holding the healthcheck back while someone streams would mean the one
    // time you need health data is the one time it stops being collected.
    assert.equal(isDeferrable("healthcheck"), false);
    assert.equal(isDeferrable("playback-poll"), false);
    assert.equal(isDeferrable("purge-runs"), false);
  });
});
