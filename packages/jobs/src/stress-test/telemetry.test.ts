/**
 * The arithmetic behind the run's time series.
 *
 * These are the parts that decide what a chart says a server did, and — since
 * `aggregateWindow` now feeds `assessStep` — what the run concludes about it.
 * Both used to be inline in a ramp that only runs inside a forked child process
 * talking to a real Plex server, which is to say untested.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { aggregateWindow, buildSample, decimate, type StressTestSample } from "./telemetry.ts";

const ZERO = { ok: 0, err: 0, notReady: 0, bytes: 0 };

function sample(over: Partial<StressTestSample> = {}): StressTestSample {
  return {
    t: 0,
    step: 1,
    phase: "measure",
    started: 1,
    seen: 1,
    speed: 2,
    speedMin: 2,
    kbps: 1000,
    actualKbps: 900,
    ok: 1,
    err: 0,
    notReady: 0,
    apiError: false,
    sessions: [{ id: "a", speed: 2, kbps: 1000 }],
    ...over,
  };
}

describe("buildSample", () => {
  it("sums bandwidth across sessions rather than averaging it", () => {
    // The step row has always stored the per-session mean, which cannot answer
    // "what is this server pushing" — the only question the reading is asked.
    const s = buildSample({
      t: 100,
      step: 3,
      phase: "measure",
      started: 3,
      sessions: [{ bandwidth: 4000 }, { bandwidth: 6000 }, { bandwidth: 5000 }],
      counters: ZERO,
      prevCounters: ZERO,
      elapsedMs: 2000,
    });
    assert.equal(s.kbps, 15_000);
    assert.equal(s.seen, 3);
  });

  it("keeps a zero transcode speed out of the average", () => {
    // Plex reports speed=0 while the transcoder fills its buffer. Averaging it
    // in reads startup as saturation, which is what the settle exists to avoid.
    const s = buildSample({
      t: 0,
      step: 1,
      phase: "settle",
      started: 2,
      sessions: [{ transcodeSpeed: 0 }, { transcodeSpeed: 4 }],
      counters: ZERO,
      prevCounters: ZERO,
      elapsedMs: 2000,
    });
    assert.equal(s.speed, 4);
    assert.equal(s.speedMin, 4);
  });

  it("reports the worst session, not only the mean", () => {
    // Nine healthy streams and one stalled one average out to healthy. The
    // minimum is the reading that says a viewer is buffering.
    const s = buildSample({
      t: 0,
      step: 1,
      phase: "measure",
      started: 3,
      sessions: [{ transcodeSpeed: 5 }, { transcodeSpeed: 5 }, { transcodeSpeed: 0.5 }],
      counters: ZERO,
      prevCounters: ZERO,
      elapsedMs: 1000,
    });
    assert.equal(s.speedMin, 0.5);
    assert.equal(s.speed, 3.5);
  });

  it("derives actual throughput from the byte delta", () => {
    // 250,000 bytes over 2s is 2 Mbit over 2s: 1000 kbps.
    const s = buildSample({
      t: 0,
      step: 1,
      phase: "measure",
      started: 1,
      sessions: [],
      counters: { ...ZERO, bytes: 250_000 },
      prevCounters: ZERO,
      elapsedMs: 2000,
    });
    assert.equal(s.actualKbps, 1000);
  });

  it("does not divide by a zero interval", () => {
    const s = buildSample({
      t: 0,
      step: 1,
      phase: "start",
      started: 0,
      sessions: [],
      counters: { ...ZERO, bytes: 5000 },
      prevCounters: ZERO,
      elapsedMs: 0,
    });
    assert.equal(s.actualKbps, 0);
  });

  it("marks a failed session query rather than reporting zero sessions", () => {
    // Losing the ability to measure is not the same reading as measuring zero,
    // and `assessStep` ranks the two very differently.
    const failed = buildSample({
      t: 0,
      step: 1,
      phase: "measure",
      started: 4,
      sessions: null,
      counters: ZERO,
      prevCounters: ZERO,
      elapsedMs: 2000,
    });
    assert.equal(failed.apiError, true);
    assert.equal(failed.seen, 0);

    const empty = buildSample({
      t: 0,
      step: 1,
      phase: "measure",
      started: 4,
      sessions: [],
      counters: ZERO,
      prevCounters: ZERO,
      elapsedMs: 2000,
    });
    assert.equal(empty.apiError, false);
  });

  it("strips the client prefix so a lane label is readable", () => {
    const s = buildSample({
      t: 0,
      step: 1,
      phase: "measure",
      started: 1,
      sessions: [{ playerMachineId: "rube-stress-9f2c1a04", transcodeSpeed: 3, bandwidth: 2000 }],
      counters: ZERO,
      prevCounters: ZERO,
      elapsedMs: 1000,
      idPrefix: "rube-stress-",
    });
    assert.equal(s.sessions[0].id, "9f2c1a04");
  });

  it("never reports a negative delta when counters are reset under it", () => {
    const s = buildSample({
      t: 0,
      step: 1,
      phase: "cleanup",
      started: 0,
      sessions: [],
      counters: ZERO,
      prevCounters: { ok: 90, err: 4, notReady: 2, bytes: 10_000 },
      elapsedMs: 1000,
    });
    assert.equal(s.ok, 0);
    assert.equal(s.err, 0);
    assert.equal(s.actualKbps, 0);
  });
});

describe("aggregateWindow", () => {
  const series = [
    sample({ t: 0, kbps: 100, speed: 5, sessions: [{ id: "a", speed: 5, kbps: 100 }] }),
    sample({
      t: 1000,
      kbps: 400,
      speed: 3,
      sessions: [
        { id: "a", speed: 3, kbps: 200 },
        { id: "b", speed: 3, kbps: 200 },
      ],
    }),
    sample({
      t: 2000,
      kbps: 600,
      speed: 1,
      sessions: [
        { id: "a", speed: 1, kbps: 300 },
        { id: "b", speed: 1, kbps: 300 },
      ],
    }),
  ];

  it("only reads samples inside the window", () => {
    // The settle is sampled too, and folding a transcoder's warm-up into the
    // average is exactly the misreading the settle exists to prevent.
    const agg = aggregateWindow(series, 1000, 2000);
    assert.equal(agg.sampleCount, 2);
    assert.equal(agg.avgSpeed, 2);
  });

  it("reports both bandwidth readings, and they are different numbers", () => {
    const agg = aggregateWindow(series, 1000, 2000);
    assert.equal(agg.totalKbps, 500, "summed across sessions, averaged over time");
    assert.equal(agg.avgBandwidth, 250, "the historical per-session mean");
  });

  it("takes the highest session count seen, not the last", () => {
    // A server that drops a stream for one sample and recovers has still shown
    // us the higher number, and the dropout is what `assessStep` compares to.
    const agg = aggregateWindow(
      [sample({ t: 0, seen: 5 }), sample({ t: 500, seen: 2 }), sample({ t: 1000, seen: 5 })],
      0,
      1000,
    );
    assert.equal(agg.sessionsSeen, 5);
  });

  it("counts failed samples and excludes them from the averages", () => {
    const agg = aggregateWindow(
      [sample({ t: 0, speed: 4, kbps: 1000 }), sample({ t: 500, apiError: true, speed: null, kbps: 0, sessions: [] })],
      0,
      1000,
    );
    assert.equal(agg.sampleCount, 2, "the failed sample still counts toward the majority test");
    assert.equal(agg.apiErrors, 1);
    assert.equal(agg.avgSpeed, 4, "and contributes nothing to the reading");
    assert.equal(agg.totalKbps, 1000);
  });

  it("reports no speed at all in direct play rather than zero", () => {
    // Zero would read as a stalled transcoder. Direct play has no transcoder,
    // and a run that reported 0.0x would stop on its first step forever.
    const agg = aggregateWindow(
      [sample({ speed: null, speedMin: null, kbps: 8000, sessions: [{ id: "a", speed: null, kbps: 8000 }] })],
      0,
      0,
    );
    assert.equal(agg.avgSpeed, null);
    assert.equal(agg.totalKbps, 8000);
  });

  it("is empty rather than NaN over a window with no samples", () => {
    const agg = aggregateWindow(series, 9000, 10_000);
    assert.deepEqual(
      { ...agg },
      { sampleCount: 0, apiErrors: 0, sessionsSeen: 0, avgSpeed: null, avgBandwidth: 0, totalKbps: 0, actualKbps: 0 },
    );
  });
});

describe("decimate", () => {
  const series = (n: number) => Array.from({ length: n }, (_, i) => sample({ t: i * 1000 }));

  it("leaves a series under the cap alone", () => {
    assert.equal(decimate(series(50), 100).length, 50);
  });

  it("brings a series down to the cap", () => {
    assert.ok(decimate(series(1000), 100).length <= 100);
  });

  it("keeps the run's whole span, not its tail", () => {
    // A ring buffer would keep the last N, and the last N of a stress run is
    // the degraded part with nothing healthy left to read it against.
    const out = decimate(series(1000), 100);
    assert.equal(out[0].t, 0);
    assert.equal(out.at(-1)!.t, 999_000);
  });

  it("thins the old half and leaves the recent half intact", () => {
    const out = decimate(series(100), 80);
    const recent = out.filter((s) => s.t >= 50_000);
    assert.equal(recent.length, 50, "every recent sample survives the first pass");
  });

  it("keeps time moving forward", () => {
    const out = decimate(series(4000), 300);
    for (let i = 1; i < out.length; i++) assert.ok(out[i].t > out[i - 1].t);
  });

  it("terminates on a cap too small to halve", () => {
    // Only a test would ask for this, but a loop that cannot converge is a
    // hung worker rather than a bad chart.
    assert.equal(decimate(series(20), 2).length, 2);
  });
});
