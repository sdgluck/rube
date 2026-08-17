/**
 * The matrix exists because the routing decision is spread across three
 * independent allow-lists and a clock, and nobody could hold all four at once.
 * These are the combinations where the answer is not the obvious one: an empty
 * allow-list means "all", not "none", and quiet hours drop an event that every
 * cell in its row says is subscribed.
 *
 * Against a real migrated database rather than a fake config: the whole point
 * is that this agrees with what `notifyEvent` reads.
 */
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";

setupTempDb("tinkerbell-notif-routing-test-");

const { setConfig } = await import("@tinkerbell/core");
const { routingMatrix } = await import("./index.ts");

/** 09:00 UTC on a Wednesday — outside any quiet window these tests set. */
const DAYTIME = new Date("2025-01-15T09:00:00Z");

function row(type: string, now = DAYTIME) {
  const found = routingMatrix(now).find((r) => r.type === type);
  assert.ok(found, `no row for ${type}`);
  return found;
}

function cell(type: string, service: string, now = DAYTIME) {
  const found = row(type, now).services.find((s) => s.service === service);
  assert.ok(found, `no cell for ${service}`);
  return found;
}

describe("routingMatrix", () => {
  beforeEach(() => {
    setConfig("global_discord_events", []);
    setConfig("global_discord_jobs", []);
    setConfig("global_discord_health_targets", []);
    setConfig("global_slack_events", []);
    setConfig("notifications_quiet_hours", { enabled: false, from: "23:00", to: "07:00", allowUrgent: true });
  });

  test("an unsubscribed service is off", () => {
    assert.equal(cell("job.failed", "discord").state, "off");
  });

  test("a subscription with no allow-list is on, not filtered", () => {
    setConfig("global_discord_events", ["job.failed"]);
    assert.equal(cell("job.failed", "discord").state, "on");
  });

  test("a job allow-list narrows job events and nothing else", () => {
    setConfig("global_discord_events", ["job.failed", "media.added"]);
    setConfig("global_discord_jobs", ["generate"]);

    const job = cell("job.failed", "discord");
    assert.equal(job.state, "filtered");
    assert.deepEqual(job.filter, ["generate"]);

    // The same allow-list must not narrow an event that isn't a job event —
    // this is the axis that reads as global on the settings form.
    assert.equal(cell("media.added", "discord").state, "on");
  });

  test("a health allow-list narrows health events only", () => {
    setConfig("global_discord_events", ["health.failed", "job.failed"]);
    setConfig("global_discord_health_targets", ["Radarr"]);

    assert.equal(cell("health.failed", "discord").state, "filtered");
    assert.equal(cell("job.failed", "discord").state, "on");
  });

  test("services are independent", () => {
    setConfig("global_discord_events", ["job.failed"]);
    assert.equal(cell("job.failed", "discord").state, "on");
    assert.equal(cell("job.failed", "slack").state, "off");
  });

  test("quiet hours suppress the row without changing any cell", () => {
    setConfig("global_discord_events", ["job.failed"]);
    setConfig("notifications_quiet_hours", { enabled: false, from: "08:00", to: "18:00", allowUrgent: true });
    assert.equal(row("job.failed").suppressed, null);

    setConfig("notifications_quiet_hours", { enabled: true, from: "08:00", to: "18:00", allowUrgent: true });
    const quiet = row("job.failed");
    assert.match(quiet.suppressed ?? "", /quiet hours/);
    // The subscription is unchanged — suppression is about the clock, and a
    // cell that flipped to "off" would read as "you unsubscribed".
    assert.equal(quiet.services.find((s) => s.service === "discord")?.state, "on");
  });

  test("the urgent exemption lets plex.unreachable through quiet hours", () => {
    setConfig("notifications_quiet_hours", { enabled: true, from: "08:00", to: "18:00", allowUrgent: true });
    assert.equal(row("plex.unreachable").suppressed, null);
    assert.match(row("health.failed").suppressed ?? "", /quiet hours/);

    setConfig("notifications_quiet_hours", { enabled: true, from: "08:00", to: "18:00", allowUrgent: false });
    assert.match(row("plex.unreachable").suppressed ?? "", /quiet hours/);
  });

  test("digest.sent is present but marked as not emitted", () => {
    const digest = row("digest.sent");
    assert.equal(digest.emitted, false);
    // Everything else is a real event.
    assert.ok(routingMatrix(DAYTIME).every((r) => r.emitted || r.type === "digest.sent"));
  });
});
