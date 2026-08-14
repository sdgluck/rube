/**
 * When a measurement phase stops.
 *
 * Every bug this loop has shipped was in the stopping condition rather than in
 * the transfers: rounds sized so a slow link would blow the whole deadline, a
 * byte ceiling noticed only after being overshot by a full round, and a
 * ceiling left four-fifths unused because the last round was skipped rather
 * than trimmed. A live run against Cloudflare surfaces those by accident if at
 * all — the first two only showed up because the numbers happened to look odd.
 *
 * So the link is simulated instead: a transfer that advances a virtual clock
 * by exactly `bytes / rate`, which makes the budget arithmetic deterministic
 * and instant at any speed from dial-up to 10 Gbps.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MEASURE_MS, runPhase, STREAMS, type Transfer } from "./transfer.ts";

const MB = 1_000_000;

/** A link of a fixed speed, and the clock that its transfers advance. */
function simulate(bytesPerSec: number) {
  let clock = 0;
  const rounds: number[] = [];
  // Streams within a round run concurrently and share the link, so the round
  // costs total-bytes/rate — advanced once per round, not once per stream.
  let pending = 0;
  const transfer = async (size: number): Promise<Transfer> => {
    pending += size;
    // `Promise.all` starts every stream before any resolves, so the clock is
    // advanced by the whole round on the first continuation.
    await Promise.resolve();
    if (pending > 0) {
      clock += (pending / bytesPerSec) * 1000;
      rounds.push(pending);
      pending = 0;
    }
    return { bytes: size, pop: "TEST" };
  };
  return { transfer, now: () => clock, rounds };
}

const never = new AbortController().signal;

describe("runPhase", () => {
  it("uses its byte ceiling on a link fast enough to reach it", async () => {
    // 1 Gbps: the ceiling binds long before the 10s window.
    const link = simulate(125 * MB);
    const result = await runPhase(120 * MB, link.transfer, never, link.now);

    assert.ok(result.movedBytes <= 120 * MB, `moved ${result.movedBytes}, over the ceiling`);
    // The regression this exists for: a phase that gave up with most of the
    // ceiling unspent, reporting a figure sampled over a fraction of a second.
    assert.ok(result.measuredBytes > 100 * MB, `only measured ${result.measuredBytes} of a 120 MB budget`);
    assert.ok(result.measuredMs > 500, `measured over only ${result.measuredMs.toFixed(0)}ms`);
  });

  it("stops on the time window, well under the ceiling, on an ordinary link", async () => {
    // 25 Mbps — a common upload speed. The 10s window should end the phase.
    const link = simulate(3.125 * MB);
    const result = await runPhase(120 * MB, link.transfer, never, link.now);

    assert.ok(result.measuredMs >= MEASURE_MS, `stopped after ${result.measuredMs.toFixed(0)}ms`);
    assert.ok(result.movedBytes < 50 * MB, `moved ${result.movedBytes} on a slow link`);
  });

  it("keeps a slow link's rounds short enough to survive the whole-test deadline", async () => {
    // 1 Mbps. The failure mode this guards: a fixed 25 MB × 4 round here would
    // take thirteen minutes and be killed mid-transfer by the 90s budget.
    const link = simulate(125_000);
    const result = await runPhase(120 * MB, link.transfer, never, link.now);

    const longest = Math.max(...link.rounds.map((bytes) => (bytes / 125_000) * 1000));
    assert.ok(longest < 30_000, `longest round took ${(longest / 1000).toFixed(0)}s`);
    assert.ok(result.measuredBytes > 0);
  });

  it("reports the throughput it actually measured, at any speed", async () => {
    for (const rate of [125_000, 3.125 * MB, 125 * MB]) {
      const link = simulate(rate);
      const { measuredBytes, measuredMs } = await runPhase(120 * MB, link.transfer, never, link.now);
      const observed = (measuredBytes / measuredMs) * 1000;
      // Within 1% — the simulated link has no per-request overhead, so the
      // only difference should be floating-point noise.
      assert.ok(Math.abs(observed - rate) / rate < 0.01, `measured ${observed} B/s on a ${rate} B/s link`);
    }
  });

  it("stops immediately when the deadline is already gone", async () => {
    const link = simulate(125 * MB);
    const result = await runPhase(120 * MB, link.transfer, AbortSignal.abort(), link.now);

    // The warm-up still runs — it's the caller's abort that interrupts it in
    // production — but no measured round follows it.
    assert.equal(result.measuredBytes, 0);
    assert.equal(result.measuredMs, 0);
  });

  it("counts the warm-up towards the cost but not towards the measurement", async () => {
    const link = simulate(125 * MB);
    const result = await runPhase(120 * MB, link.transfer, never, link.now);

    assert.equal(result.movedBytes - result.measuredBytes, 1 * MB);
  });

  it("runs on its own clock when the caller doesn't supply one", async () => {
    // The default argument is the only line of this function the other tests
    // never execute — they all inject a clock — and it shipped broken: a bare
    // `performance.now` reference throws `Value of "this" must be of type
    // Performance` the moment it's called detached from `performance`. Every
    // real run failed on the first phase while the suite stayed green.
    const transfer = async (size: number): Promise<Transfer> => ({ bytes: size, pop: null });
    const result = await runPhase(5 * MB, transfer, never);

    assert.ok(result.movedBytes > 0);
    assert.ok(result.measuredMs >= 0);
  });

  it("never launches more than the configured number of streams at once", async () => {
    let inFlight = 0;
    let peak = 0;
    let clock = 0;
    const transfer = async (size: number): Promise<Transfer> => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      clock += size / 1000;
      inFlight--;
      return { bytes: size, pop: null };
    };
    await runPhase(20 * MB, transfer, never, () => clock);

    assert.equal(peak, STREAMS);
  });
});
