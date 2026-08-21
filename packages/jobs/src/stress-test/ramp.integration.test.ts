/**
 * The ramp end to end: the real `runStressTest` against a real HTTP mock Plex.
 *
 * A `fetch` stub would agree with the harness about every URL it builds, which
 * is exactly where this feature's bugs lived — a variant playlist URL joined
 * the wrong way, a direct-play stream addressed to a path that does not exist,
 * a filter on the wrong watch-state field. So the assertions here are made
 * against what the server was actually asked for.
 *
 * The stabilisation and sampling waits are overridden to milliseconds. Nothing
 * else is faked: real transcode sessions are started and stopped, real segments
 * are pulled, real timelines are reported, and `/status/sessions` answers from
 * the timelines it received.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { JobContext } from "@tinkerbell/core";
import type { MockPlex } from "../test-support/mock-plex-server.ts";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { DbToken } from "@tinkerbell/db";
import { ConfigStoreToken, noopCheckpoint } from "@tinkerbell/core";
import { stressTestRuns } from "@tinkerbell/db";
import { createPlexClient } from "@tinkerbell/plex";
import { eq } from "drizzle-orm";
import { createStressTest } from "./index.ts";

const c = createTestContainer();
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const { runStressTest, getStressTestRun, saveStressTestResult } = createStressTest(services);

const { startMockPlex } = await import("../test-support/mock-plex-server.ts");

/**
 * Fast enough that a six-step ramp is under a second, slow enough that a
 * client's opening request lands inside the measurement window — which is the
 * relationship the real 15s/6s values have, just scaled down.
 */
const FAST = { stabiliseMs: 60, sampleCount: 3, sampleIntervalMs: 5, confirmSettleMs: 20 };

const SECTIONS = [{ key: "1", title: "Films", type: "movie" }];

/**
 * Six unwatched films, one part-watched, one finished.
 *
 * The last two are the point of the fixture. The harness unscrobbles everything
 * it played, so anything with existing watch state must never be selected —
 * and a *finished* film has a view count and no offset, which is precisely the
 * case a `viewOffset`-only filter waves through.
 */
const ITEMS = [
  ...Array.from({ length: 6 }, (_, i) => ({
    ratingKey: String(100 + i),
    title: `Unwatched ${i}`,
    sectionId: "1",
    guids: [],
    labels: [],
    duration: 5_400_000,
  })),
  {
    ratingKey: "900",
    title: "Half Watched",
    sectionId: "1",
    guids: [],
    labels: [],
    duration: 5_400_000,
    viewOffset: 1_200_000,
  },
  {
    ratingKey: "901",
    title: "Already Seen",
    sectionId: "1",
    guids: [],
    labels: [],
    duration: 5_400_000,
    viewCount: 1,
  },
];

let plex: MockPlex;

function testContext(signal?: AbortSignal): { ctx: JobContext; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    ctx: {
      scope: c.createScope("test"),
      log: (...args: unknown[]) => lines.push(args.map(String).join(" ")),
      progress: () => {},
      signal: signal ?? new AbortController().signal,
      checkpoint: noopCheckpoint,
    },
  };
}

function client() {
  return createPlexClient({ url: plex.origin, token: "tok" });
}

before(async () => {
  plex = await startMockPlex({ sections: SECTIONS, items: ITEMS });
  setConfig("global_plex_url", plex.origin);
  setConfig("global_plex_token", "tok");
});

beforeEach(async () => {
  await plex.close();
  plex = await startMockPlex({ sections: SECTIONS, items: ITEMS });
  setConfig("global_plex_url", plex.origin);
});

after(() => plex?.close());

describe("the ramp, against a healthy server", () => {
  it("ramps to the cap and reports it as the supported session count", async () => {
    const { ctx } = testContext();
    const result = await runStressTest(client(), { mode: "transcode", maxSessions: 3 }, ctx, { timings: FAST });

    assert.equal(result.maxSessions, 3);
    assert.equal(result.steps.length, 3);
    assert.deepEqual(
      result.steps.map((s) => s.sessions),
      [1, 2, 3],
    );
    assert.ok(result.steps.every((s) => s.reason == null));
  });

  it("starts a real transcode session per step and stops every one of them", async () => {
    const { ctx } = testContext();
    await runStressTest(client(), { mode: "transcode", maxSessions: 3 }, ctx, { timings: FAST });

    assert.equal(plex.journal.transcodeStarts.length, 3);
    // Cleanup runs in a `finally`, so this holds whatever the outcome.
    assert.deepEqual([...plex.journal.transcodeStops].sort(), [...plex.journal.transcodeStarts].sort());
  });

  it("pulls actual segments, following the absolute variant URL Plex hands back", async () => {
    const { ctx } = testContext();
    await runStressTest(client(), { mode: "transcode", maxSessions: 1 }, ctx, { timings: FAST });

    const segments = plex.journal.streamFetches.filter((f) => f.path.endsWith(".ts"));
    assert.ok(segments.length > 0, "expected segment fetches");
    // Nothing was addressed to a mangled path. This is the exact shape the old
    // URL joining produced.
    assert.equal(
      plex.journal.unhandled.filter((u) => u.includes("http:")).length,
      0,
      `mangled URLs reached the server: ${JSON.stringify(plex.journal.unhandled)}`,
    );
  });

  it("consumes segments at playback pace instead of racing the transcoder", async () => {
    // Found against a real server, not by reading the code: the client used to
    // fetch every segment the playlist listed as fast as the link allowed —
    // ~226 requests a second, 95% of them 404s for segments the transcoder had
    // not produced yet. A stress test that spends its budget on 404s measures
    // nothing. The bound here is loose; the hot loop was two orders out.
    const { ctx } = testContext();
    const before = Date.now();
    await runStressTest(client(), { mode: "transcode", maxSessions: 1 }, ctx, {
      timings: { stabiliseMs: 400, sampleCount: 2, sampleIntervalMs: 50 },
    });
    const elapsedSec = (Date.now() - before) / 1000;

    const segmentFetches = plex.journal.streamFetches.filter((f) => f.path.endsWith(".ts")).length;
    assert.ok(segmentFetches > 0, "expected the session to pull segments at all");
    assert.ok(
      segmentFetches / elapsedSec < 20,
      `${Math.round(segmentFetches / elapsedSec)} segment fetches/sec — the client is racing ahead`,
    );
  });

  it("reports a playing timeline per session, then a stopped one", async () => {
    const { ctx } = testContext();
    await runStressTest(client(), { mode: "transcode", maxSessions: 2 }, ctx, { timings: FAST });

    const playing = plex.journal.timelines.filter((t) => t.state === "playing");
    const stopped = plex.journal.timelines.filter((t) => t.state === "stopped");
    assert.equal(new Set(playing.map((t) => t.clientId)).size, 2);
    assert.equal(new Set(stopped.map((t) => t.clientId)).size, 2);
  });
});

describe("direct play", () => {
  it("streams the part key, not the server's own file path", async () => {
    const { ctx } = testContext();
    await runStressTest(client(), { mode: "directplay", maxSessions: 1 }, ctx, { timings: FAST });

    const parts = plex.journal.streamFetches.filter((f) => f.path.startsWith("/library/parts/"));
    assert.ok(parts.length > 0, "expected direct-play part fetches");
    assert.equal(plex.journal.transcodeStarts.length, 0, "direct play must not start a transcode");
  });

  it("can report degradation — it is not permanently healthy", async () => {
    // The regression: with no transcode speed to read, the old judgement had no
    // signal at all, so a direct-play run ramped to the configured cap every
    // time and reported it as the server's capacity. A server that only admits
    // to two sessions must stop the ramp at two.
    plex.playback.capacity = 2;
    const { ctx } = testContext();
    const result = await runStressTest(client(), { mode: "directplay", maxSessions: 5 }, ctx, { timings: FAST });

    assert.equal(result.maxSessions, 2);
    assert.match(result.steps.at(-1)!.reason!, /1 of 3 session\(s\) dropped out/);
  });
});

describe("degradation", () => {
  it("stops the ramp when transcode speed falls below realtime", async () => {
    plex.playback.transcodeSpeed = 0.4;
    const { ctx } = testContext();
    const result = await runStressTest(client(), { mode: "transcode", maxSessions: 5 }, ctx, { timings: FAST });

    assert.equal(result.maxSessions, 0, "the first step already showed a struggling server");
    assert.match(result.steps.at(-1)!.reason!, /below realtime/);
  });

  it("excludes the degraded step from the supported count", async () => {
    // A server that keeps up to three streams and falls behind on the fourth.
    plex.playback.transcodeSpeed = (live) => (live >= 4 ? 0.5 : 2.5);
    const { ctx } = testContext();
    const result = await runStressTest(client(), { mode: "transcode", maxSessions: 6 }, ctx, { timings: FAST });

    assert.equal(result.maxSessions, 3, "three were healthy; the fourth is what broke it");
    assert.equal(result.steps.length, 4, "the failing step is recorded, it just doesn't count");
    assert.match(result.steps.at(-1)!.reason!, /below realtime/);
  });
});

describe("confirming degradation before believing it", () => {
  it("does not let a single bad window cap the answer", async () => {
    // The ramp stops at the first bad window and that number is the headline
    // result, so one unlucky reading used to understate the server permanently.
    // Here the server dips below realtime for exactly one measurement and then
    // recovers; the ramp must shrug it off and carry on.
    let windows = 0;
    plex.playback.transcodeSpeed = () => {
      windows++;
      // Sampled three times per window, so this dips for one window only.
      return windows > 3 && windows <= 6 ? 0.4 : 2.5;
    };

    const { ctx, lines } = testContext();
    const result = await runStressTest(client(), { mode: "transcode", maxSessions: 4 }, ctx, { timings: FAST });

    assert.equal(result.maxSessions, 4, "a transient dip must not stop the ramp");
    assert.ok(
      lines.some((l) => /did not reproduce/.test(l)),
      "expected the retry to be reported",
    );
    assert.ok(lines.some((l) => /did not reproduce.*|noisy/.test(l)));
  });

  it("still stops when the degradation is real and reproduces", async () => {
    // The counterpart: once it is genuinely slow, re-measuring must agree and
    // the ramp must stop. Confirmation is a filter, not a bypass.
    plex.playback.transcodeSpeed = (live) => (live >= 3 ? 0.4 : 2.5);

    const { ctx } = testContext();
    const result = await runStressTest(client(), { mode: "transcode", maxSessions: 5 }, ctx, { timings: FAST });

    assert.equal(result.maxSessions, 2);
    assert.match(result.steps.at(-1)!.reason!, /below realtime/);
  });
});

describe("the transcode session protocol", () => {
  it("registers a decision for every session, so they survive each other", async () => {
    // The bug this pins: `start.m3u8` alone returns 200 and yields a valid
    // playlist, but Plex treats an un-decided session as a throwaway and
    // discards it when the next transcode starts. One session works fine, so
    // the omission is invisible until something tries to run two — which is
    // exactly how it survived unnoticed. Measured on a real server: 1 of 5
    // alive without the decision call, 5 of 5 with it, nothing else changed.
    const { ctx } = testContext();
    const result = await runStressTest(client(), { mode: "transcode", maxSessions: 4 }, ctx, { timings: FAST });

    assert.equal(result.maxSessions, 4, "sessions must survive one another");
    assert.deepEqual(
      [...plex.journal.transcodeDecisions].sort(),
      [...plex.journal.transcodeStarts].sort(),
      "every started session must first have registered a decision",
    );
  });

  it("holds every session concurrently rather than replacing them", async () => {
    const { ctx } = testContext();
    const result = await runStressTest(client(), { mode: "transcode", maxSessions: 5 }, ctx, { timings: FAST });

    // Each step must see one more session than the last: that is concurrency,
    // as opposed to the same single session being restarted five times.
    assert.deepEqual(
      result.steps.map((s) => s.sessionsSeen),
      [1, 2, 3, 4, 5],
    );
    assert.equal(result.maxSessions, 5);
  });
});

describe("watch history", () => {
  it("never selects an item that already has watch state", async () => {
    // maxSessions 4 means a pool target of 8 — the whole library — so the
    // part-watched and finished films are both offered to the filter and must
    // both be turned down.
    const { ctx, lines } = testContext();
    await runStressTest(client(), { mode: "transcode", maxSessions: 4 }, ctx, { timings: FAST });

    const played = new Set(plex.journal.timelines.map((t) => t.ratingKey));
    assert.equal(played.has("900"), false, "part-watched item was played");
    assert.equal(played.has("901"), false, "already-watched item was played");
    assert.ok(lines.some((l) => /Skipped 2 already-watched/.test(l)));
  });

  it("only unscrobbles items it played, so real watch history survives", async () => {
    // `markUnwatched` is destructive. Before, a finished movie could be chosen
    // and would then be permanently marked unwatched on the user's server.
    const { ctx } = testContext();
    await runStressTest(client(), { mode: "transcode", maxSessions: 3 }, ctx, { timings: FAST });

    const played = new Set(plex.journal.timelines.map((t) => t.ratingKey));
    assert.ok(plex.journal.unscrobbled.length > 0, "expected the run to undo its own history");
    for (const key of plex.journal.unscrobbled) {
      assert.ok(played.has(key), `unscrobbled ${key}, which it never played`);
    }
    assert.equal(plex.journal.unscrobbled.includes("901"), false);
  });
});

describe("cancellation", () => {
  it("cleans up every session it started when aborted mid-ramp", async () => {
    const controller = new AbortController();
    const { ctx } = testContext(controller.signal);
    const run = runStressTest(client(), { mode: "transcode", maxSessions: 10 }, ctx, { timings: FAST });
    setTimeout(() => controller.abort(), 60);
    await run;

    assert.ok(plex.journal.transcodeStarts.length > 0);
    assert.deepEqual([...plex.journal.transcodeStops].sort(), [...plex.journal.transcodeStarts].sort());
    assert.ok(plex.journal.unscrobbled.length > 0, "cleanup must still undo watch history on abort");
  });

  it("does not overwrite a cancelled row's status with 'completed'", async () => {
    // The bug: `saveStressTestResult` wrote `status: "completed"` on the update
    // path, so the cleanup of a cancelled run filed it as a normal result.
    const id = "cancelled-run";
    db.insert(stressTestRuns)
      .values({ id, config: { mode: "transcode" }, steps: [], status: "running", startedAt: 1 })
      .run();
    db.update(stressTestRuns).set({ status: "cancelled" }).where(eq(stressTestRuns.id, id)).run();

    saveStressTestResult(id, {
      config: { mode: "transcode" },
      maxSessions: 2,
      steps: [],
      startedAt: 1,
      finishedAt: 2,
    });

    const row = getStressTestRun(id)!;
    assert.equal(row.status, "cancelled");
    assert.equal(row.maxSessions, 2, "the measurements it did take are still recorded");
  });
});

describe("stored rows", () => {
  it("survives a config it cannot parse rather than failing the whole listing", async () => {
    db.insert(stressTestRuns)
      .values({
        id: "legacy",
        // A mode this build has never heard of.
        config: { mode: "warp-speed" } as never,
        steps: [],
        status: "completed",
        startedAt: 5,
      })
      .run();

    assert.doesNotThrow(() => getStressTestRun("legacy"));
    assert.equal(getStressTestRun("legacy")!.steps.length, 0);
  });
});
