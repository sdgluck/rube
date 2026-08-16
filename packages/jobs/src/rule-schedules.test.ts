/**
 * `isDue` is a poll, which means it is wrong in one of two ways or it is
 * right: it fires nothing ever, or it fires the same rule every minute. Both
 * are invisible for a while and expensive by the time they aren't.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { isDue } from "./rule-schedules.ts";

const UTC = "UTC";
const at = (iso: string) => new Date(iso);
const ms = (iso: string) => at(iso).getTime();

test("isDue", async (t) => {
  await t.test("a rule with no cron never comes due", () => {
    assert.equal(isDue(undefined, ms("2026-01-01T00:00:00Z"), at("2026-06-01T12:00:00Z"), UTC), null);
    assert.equal(isDue({}, ms("2026-01-01T00:00:00Z"), at("2026-06-01T12:00:00Z"), UTC), null);
  });

  await t.test("a schedule never seen before waits to be adopted", () => {
    // Firing here would run every rule the moment it was saved.
    assert.equal(isDue({ cron: "0 * * * *" }, null, at("2026-06-01T12:30:00Z"), UTC), null);
  });

  await t.test("not due between occurrences", () => {
    const due = isDue({ cron: "0 * * * *" }, ms("2026-06-01T12:00:00Z"), at("2026-06-01T12:30:00Z"), UTC);
    assert.equal(due, null);
  });

  await t.test("due once the occurrence has passed, and reports which one", () => {
    const due = isDue({ cron: "0 * * * *" }, ms("2026-06-01T12:00:00Z"), at("2026-06-01T13:00:30Z"), UTC);
    assert.equal(due, ms("2026-06-01T13:00:00Z"));
  });

  await t.test("a missed window catches up once, at the most recent occurrence", () => {
    // Down from 12:00 to 16:30 owes four hourly runs. Running four times would
    // just overwrite the same collections three times over.
    const due = isDue({ cron: "0 * * * *" }, ms("2026-06-01T12:00:00Z"), at("2026-06-01T16:30:00Z"), UTC);
    assert.equal(due, ms("2026-06-01T16:00:00Z"));
  });

  await t.test("a very long outage collapses to a single run", () => {
    // A year of hourly occurrences is far past the catch-up cap; the rule
    // should run once, now, rather than 8,760 times or not at all.
    const due = isDue({ cron: "0 * * * *" }, ms("2025-06-01T12:00:00Z"), at("2026-06-01T12:00:00Z"), UTC);
    assert.equal(due, ms("2026-06-01T12:00:00Z"));
  });

  await t.test("an invalid expression is ignored rather than thrown", () => {
    assert.equal(isDue({ cron: "not a cron" }, ms("2026-06-01T12:00:00Z"), at("2026-06-01T13:00:00Z"), UTC), null);
  });

  await t.test("an out-of-season rule does not fire on its own cron either", () => {
    const schedule = { cron: "0 * * * *", activeFrom: "10-01", activeTo: "11-05" };
    assert.equal(isDue(schedule, ms("2026-06-01T12:00:00Z"), at("2026-06-01T13:00:00Z"), UTC), null);
  });

  await t.test("an in-season rule fires normally", () => {
    const schedule = { cron: "0 * * * *", activeFrom: "10-01", activeTo: "11-05" };
    const due = isDue(schedule, ms("2026-10-15T12:00:00Z"), at("2026-10-15T13:00:30Z"), UTC);
    assert.equal(due, ms("2026-10-15T13:00:00Z"));
  });
});
