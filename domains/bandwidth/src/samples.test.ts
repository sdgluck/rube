/**
 * Bucketing for the usage sparkline.
 *
 * Two things are asserted here that a graph would never show you: that a
 * bucket reports its peak rather than its mean — averaging is what hides the
 * one minute the link was full — and that a re-sampled instant overwrites
 * itself rather than doubling that bucket.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";

setupTempDb();

const { db, bandwidthSamples } = await import("@tinkerbell/db");
const { getBandwidthSeries, recordBandwidthSample, pruneBandwidthSamples } = await import("./store.ts");

const HOUR = 3_600_000;
const NOW = 1_760_000_000_000;

beforeEach(() => {
  db.delete(bandwidthSamples).run();
});

describe("getBandwidthSeries", () => {
  it("returns one bucket per slice, zeroed when nothing was sampled", () => {
    assert.deepEqual(getBandwidthSeries(4, 4 * HOUR, NOW), [0, 0, 0, 0]);
  });

  it("reports each bucket's peak, not its mean", () => {
    // One minute at 400 Mbps inside an hour that otherwise idles is the whole
    // point of keeping the history — a mean would report ~20.
    recordBandwidthSample({ sampledAt: NOW - HOUR + 60_000, kbps: 20_000, streams: 1 });
    recordBandwidthSample({ sampledAt: NOW - HOUR + 120_000, kbps: 400_000, streams: 9 });
    recordBandwidthSample({ sampledAt: NOW - HOUR + 180_000, kbps: 20_000, streams: 1 });
    assert.deepEqual(getBandwidthSeries(2, 2 * HOUR, NOW), [0, 400_000]);
  });

  it("puts a sample in the bucket its timestamp falls in", () => {
    recordBandwidthSample({ sampledAt: NOW - 4 * HOUR + 1, kbps: 100, streams: 1 });
    recordBandwidthSample({ sampledAt: NOW - 2 * HOUR + 1, kbps: 200, streams: 1 });
    recordBandwidthSample({ sampledAt: NOW - 1, kbps: 300, streams: 1 });
    assert.deepEqual(getBandwidthSeries(4, 4 * HOUR, NOW), [100, 0, 200, 300]);
  });

  it("excludes samples older than the window", () => {
    recordBandwidthSample({ sampledAt: NOW - 4 * HOUR - 1, kbps: 999, streams: 3 });
    assert.deepEqual(getBandwidthSeries(4, 4 * HOUR, NOW), [0, 0, 0, 0]);
  });

  it("overwrites a repeated instant rather than counting it twice", () => {
    const at = NOW - HOUR;
    recordBandwidthSample({ sampledAt: at, kbps: 500, streams: 2 });
    recordBandwidthSample({ sampledAt: at, kbps: 100, streams: 1 });
    assert.equal(db.select().from(bandwidthSamples).all().length, 1);
    assert.deepEqual(getBandwidthSeries(2, 2 * HOUR, NOW), [0, 100]);
  });
});

describe("pruneBandwidthSamples", () => {
  it("keeps the last week and drops what precedes it", () => {
    const now = Date.now();
    recordBandwidthSample({ sampledAt: now - 8 * 24 * HOUR, kbps: 1, streams: 0 });
    recordBandwidthSample({ sampledAt: now - 6 * 24 * HOUR, kbps: 2, streams: 0 });
    assert.equal(pruneBandwidthSamples(), 1);
    assert.deepEqual(
      db
        .select()
        .from(bandwidthSamples)
        .all()
        .map((r) => r.kbps),
      [2],
    );
  });
});
