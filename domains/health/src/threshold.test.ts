/**
 * The failure threshold changes when `health.failed` is announced, and both
 * ways of getting it wrong are worse than not having it. Announce on every
 * failed check above the threshold and a day-long outage becomes a message a
 * minute; announce the recovery from an outage that was never announced and
 * raising the threshold turns a flapping service from noisy in both
 * directions into silent when it breaks and chatty when it returns.
 *
 * Counted from the table rather than from memory, so a restart mid-outage
 * cannot reset the streak and re-announce — the process is restarted by every
 * upgrade, which is exactly when a server is most likely to be unreachable.
 */
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";

setupTempDb("tinkerbell-health-threshold-test-");

const { db, events, healthChecks } = await import("@tinkerbell/db");
const { setConfig } = await import("@tinkerbell/core");
const { reportHealth } = await import("./index.ts");

function emitted(type: string): number {
  return db
    .select()
    .from(events)
    .all()
    .filter((e) => e.type === type).length;
}

beforeEach(() => {
  db.delete(healthChecks).run();
  db.delete(events).run();
});

describe("health failure threshold", () => {
  test("defaults to announcing the first failure", () => {
    reportHealth("Radarr", "ok", "fine");
    reportHealth("Radarr", "error", "refused");
    assert.equal(emitted("health.failed"), 1);
  });

  test("a service's very first check can still announce a failure", () => {
    // This used to return early on a missing previous row, on the grounds that a
    // fresh install would announce every unconfigured service. But
    // `checkAllConfiguredServices` only probes services that *are* configured, so
    // a first failing check means a server somebody set up is not answering —
    // and swallowing it also lost the first failure of a newly added *Arr
    // instance, and of any service whose rows had been pruned.
    reportHealth("Radarr", "error", "refused");
    assert.equal(emitted("health.failed"), 1);
  });

  test("a recovery with no announced outage behind it stays quiet", () => {
    // Nothing to recover from as far as anyone was told.
    reportHealth("Radarr", "ok", "fine");
    assert.equal(emitted("health.recovered"), 0);
  });

  test("lowering the threshold mid-outage still announces the failure", () => {
    // The pairing this whole design is about. The streak used to be read with
    // the threshold as a row limit, so lowering 5 → 2 during a four-check outage
    // left `priorFailures` at 2, the failure edge never matched, and no failure
    // was announced — while the eventual recovery *was*. Silent when it breaks,
    // chatty when it returns.
    setConfig("health_failure_threshold", 5);
    reportHealth("Radarr", "ok", "fine");
    for (let i = 0; i < 4; i++) reportHealth("Radarr", "error", "refused");
    assert.equal(emitted("health.failed"), 0, "four of five, so nothing yet");

    setConfig("health_failure_threshold", 2);
    reportHealth("Radarr", "error", "refused");
    assert.equal(emitted("health.failed"), 1);

    reportHealth("Radarr", "ok", "fine");
    assert.equal(emitted("health.recovered"), 1, "announced, so its recovery is announced too");
  });

  test("raising the threshold mid-outage does not re-announce it", () => {
    setConfig("health_failure_threshold", 1);
    reportHealth("Radarr", "ok", "fine");
    reportHealth("Radarr", "error", "refused");
    assert.equal(emitted("health.failed"), 1);

    setConfig("health_failure_threshold", 5);
    for (let i = 0; i < 6; i++) reportHealth("Radarr", "error", "refused");
    assert.equal(emitted("health.failed"), 1, "one outage, one message");
  });

  test("with a threshold of 3, two failures stay quiet and the third speaks", () => {
    setConfig("health_failure_threshold", 3);
    reportHealth("Radarr", "ok", "fine");

    reportHealth("Radarr", "error", "refused");
    assert.equal(emitted("health.failed"), 0);
    reportHealth("Radarr", "error", "refused");
    assert.equal(emitted("health.failed"), 0);
    reportHealth("Radarr", "error", "refused");
    assert.equal(emitted("health.failed"), 1);
  });

  test("a continuing outage is announced once, not once per check", () => {
    setConfig("health_failure_threshold", 2);
    reportHealth("Radarr", "ok", "fine");
    for (let i = 0; i < 6; i++) reportHealth("Radarr", "error", "refused");
    assert.equal(emitted("health.failed"), 1);
  });

  test("a flap that never reaches the threshold announces nothing at all", () => {
    setConfig("health_failure_threshold", 3);
    reportHealth("Radarr", "ok", "fine");
    for (let i = 0; i < 4; i++) {
      reportHealth("Radarr", "error", "refused");
      reportHealth("Radarr", "ok", "fine");
    }
    assert.equal(emitted("health.failed"), 0);
    // And crucially no recoveries either — the outage was never announced, so
    // there is nothing to recover from as far as anyone watching is concerned.
    assert.equal(emitted("health.recovered"), 0);
  });

  test("recovery is announced for an outage that was announced", () => {
    setConfig("health_failure_threshold", 2);
    reportHealth("Radarr", "ok", "fine");
    reportHealth("Radarr", "error", "refused");
    reportHealth("Radarr", "error", "refused");
    assert.equal(emitted("health.failed"), 1);

    reportHealth("Radarr", "ok", "back");
    assert.equal(emitted("health.recovered"), 1);
  });

  test("the streak survives a restart, because it is read from the table", () => {
    setConfig("health_failure_threshold", 3);
    reportHealth("Radarr", "ok", "fine");
    reportHealth("Radarr", "error", "refused");
    reportHealth("Radarr", "error", "refused");
    // A restart loses any in-memory counter; the next check must still be the
    // third of the streak rather than the first.
    reportHealth("Radarr", "error", "refused");
    assert.equal(emitted("health.failed"), 1);
  });

  test("Plex also raises the dedicated unreachable event, on the same schedule", () => {
    setConfig("health_failure_threshold", 2);
    reportHealth("Plex", "ok", "fine");
    reportHealth("Plex", "error", "timeout");
    assert.equal(emitted("plex.unreachable"), 0);
    reportHealth("Plex", "error", "timeout");
    assert.equal(emitted("plex.unreachable"), 1);
  });

  test("one service's failures do not count towards another's streak", () => {
    setConfig("health_failure_threshold", 2);
    reportHealth("Radarr", "ok", "fine");
    reportHealth("Sonarr", "ok", "fine");
    reportHealth("Radarr", "error", "refused");
    reportHealth("Sonarr", "error", "refused");
    assert.equal(emitted("health.failed"), 0);
  });
});
