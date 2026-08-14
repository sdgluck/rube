/**
 * The arithmetic a bandwidth result is only as trustworthy as. A unit slip
 * here — MB for Mb, ms for s — doesn't crash anything; it just quietly writes
 * a number that's wrong by 8x into the tile an admin plans around.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isSlowerThanUsual,
  MAX_CHUNK_BYTES,
  meanAbsoluteDeviation,
  median,
  nextChunkBytes,
  summarise,
  throughputMbps,
} from "./math.ts";

describe("throughputMbps", () => {
  it("converts bytes over milliseconds into megabits per second", () => {
    // 12.5 MB in one second is exactly 100 Mbps.
    assert.equal(throughputMbps(12_500_000, 1000), 100);
    // Same bytes over ten seconds is a tenth of the speed.
    assert.equal(throughputMbps(12_500_000, 10_000), 10);
  });

  it("is zero rather than Infinity or NaN when a phase moved nothing", () => {
    assert.equal(throughputMbps(0, 1000), 0);
    assert.equal(throughputMbps(1_000_000, 0), 0);
    assert.equal(throughputMbps(0, 0), 0);
  });
});

describe("median", () => {
  it("takes the middle of an odd sample and the mean of the middle two of an even one", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
  });

  it("is zero for an empty sample", () => {
    assert.equal(median([]), 0);
  });
});

describe("meanAbsoluteDeviation", () => {
  it("is zero for a perfectly steady link", () => {
    assert.equal(meanAbsoluteDeviation([12, 12, 12]), 0);
  });

  it("measures spread around the median, not around one outlier", () => {
    // Median 12; deviations 0, 0, 0, 88 → 22.
    assert.equal(meanAbsoluteDeviation([12, 12, 12, 100]), 22);
  });
});

describe("nextChunkBytes", () => {
  const STREAMS = 4;
  /** A round is meant to take ~2s; this is the tolerance the assertions use. */
  const roundSeconds = (bytesPerSec: number) => (nextChunkBytes(bytesPerSec, STREAMS) * STREAMS) / bytesPerSec;

  it("keeps a round near the two-second target between the two bounds", () => {
    // 5 Mbps through 500 Mbps, in bytes/sec — the range where neither the
    // floor nor the cap binds, which is nearly every real connection.
    for (const rate of [625e3, 1.25e6, 12.5e6, 62.5e6]) {
      const seconds = roundSeconds(rate);
      assert.ok(seconds > 1 && seconds < 3, `${rate} B/s gave a ${seconds.toFixed(1)}s round`);
    }
  });

  it("caps the payload so one round can't run away on a fast link", () => {
    assert.equal(nextChunkBytes(10e9, STREAMS), MAX_CHUNK_BYTES);
    // Past ~500 Mbps the cap binds and rounds get *shorter* than the target,
    // which is the safe direction: the phase just runs more of them until its
    // time or byte ceiling stops it.
    assert.ok(roundSeconds(125e6) < 2);
  });

  it("keeps a floor so a slow link measures transfer rather than overhead", () => {
    // 1 Mbps: the target size would be ~62 KB, small enough that per-request
    // overhead would dominate what the round claims to measure.
    assert.equal(nextChunkBytes(125_000, STREAMS), 256_000);
    // The floor is what makes a round on a slow link overrun the target. It
    // has to stay well inside the whole-test budget, which is 90s.
    assert.ok(roundSeconds(125_000) < 10);
  });

  it("falls back to the floor rather than NaN when there's no rate yet", () => {
    assert.equal(nextChunkBytes(0, STREAMS), 256_000);
    assert.equal(nextChunkBytes(Number.NaN, STREAMS), 256_000);
    assert.equal(nextChunkBytes(1e6, 0), 256_000);
  });
});

describe("isSlowerThanUsual", () => {
  const baseline = [20, 21, 19, 20, 20];

  it("fires when the result is more than 30% below the usual median", () => {
    assert.equal(isSlowerThanUsual(13, baseline), true);
  });

  it("stays quiet for ordinary variation", () => {
    assert.equal(isSlowerThanUsual(18, baseline), false);
    assert.equal(isSlowerThanUsual(25, baseline), false);
  });

  it("needs a real baseline before it will claim anything", () => {
    assert.equal(isSlowerThanUsual(1, [20, 20]), false);
    assert.equal(isSlowerThanUsual(1, []), false);
  });

  it("ignores a single bad run in the baseline, which is why it uses the median", () => {
    assert.equal(isSlowerThanUsual(18, [20, 20, 1, 20, 20]), false);
  });
});

describe("summarise", () => {
  it("reads as one line of both directions plus context", () => {
    assert.equal(
      summarise({ downMbps: 94.2, upMbps: 18.14, latencyMs: 12.4, pop: "LHR" }),
      "↓ 94.2 Mbps ↑ 18.1 Mbps · 12 ms · LHR",
    );
  });

  it("says what it has when a leg never completed", () => {
    assert.equal(summarise({ downMbps: 94.2, upMbps: null, latencyMs: 12, pop: null }), "↓ 94.2 Mbps · 12 ms");
    assert.equal(summarise({ downMbps: null, upMbps: null, latencyMs: null, pop: null }), "No measurement");
  });
});
