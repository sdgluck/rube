/**
 * `rollupConsecutiveEvents` collapses runs of identical consecutive events —
 * which is the only reason the activity feed survives `healthcheck` writing an
 * event every 60 seconds.
 *
 * The grouping key joins the event type to its jobId/service with a NUL
 * separator. That separator is written as a `\u0000` escape rather than a raw
 * byte on purpose: a literal NUL makes this file read as binary to grep and
 * file(1). These tests pin the *behaviour* the separator exists for, so the
 * escape can never be "tidied" into something that collides.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rollupConsecutiveEvents } from "./index.ts";

let nextId = 1;
function event(type: string, message: string, metadata: Record<string, unknown> | null = null) {
  return { id: nextId++, type, message, metadata, timestamp: 1_700_000_000_000 + nextId * 1000 };
}

describe("rollupConsecutiveEvents", () => {
  it("collapses consecutive events for the same job", () => {
    const rolled = rollupConsecutiveEvents([
      event("job.completed", "Healthcheck completed in 1s", { jobId: "healthcheck" }),
      event("job.completed", "Healthcheck completed in 2s", { jobId: "healthcheck" }),
      event("job.completed", "Healthcheck completed in 3s", { jobId: "healthcheck" }),
    ]);

    assert.equal(rolled.length, 1);
    assert.equal(rolled[0].count, 3);
    // Durations are averaged via parseDurationMs — the serialisation pair
    // pinned in duration.test.ts.
    assert.equal(rolled[0].avgDurationMs, 2000);
  });

  it("keeps different jobs apart", () => {
    const rolled = rollupConsecutiveEvents([
      event("job.completed", "A completed in 1s", { jobId: "sync-media" }),
      event("job.completed", "B completed in 1s", { jobId: "generate" }),
    ]);
    assert.equal(rolled.length, 2);
  });

  it("does not let a crafted type/id pair collide with a different one", () => {
    // This is what the separator buys. Without a delimiter, "a" + "bc" and
    // "ab" + "c" would produce the same key and roll up into one row; a
    // printable delimiter could still be forged by a value containing it.
    const rolled = rollupConsecutiveEvents([
      event("a", "first", { jobId: "bc" }),
      event("ab", "second", { jobId: "c" }),
    ]);
    assert.equal(rolled.length, 2, "distinct type/jobId pairs must not share a rollup key");
  });

  it("falls back to the message when there is no jobId or service", () => {
    const rolled = rollupConsecutiveEvents([
      event("plex.error", "connection reset"),
      event("plex.error", "connection reset"),
      event("plex.error", "different problem"),
    ]);
    assert.equal(rolled.length, 2);
    assert.equal(rolled[0].count, 2);
  });

  it("only collapses runs that are adjacent", () => {
    const rolled = rollupConsecutiveEvents([
      event("job.completed", "A completed in 1s", { jobId: "a" }),
      event("job.completed", "B completed in 1s", { jobId: "b" }),
      event("job.completed", "A completed in 1s", { jobId: "a" }),
    ]);
    assert.equal(rolled.length, 3);
  });
});
