import { perDeps } from "@tinkerbell/container";
import { desc, gte, sql } from "drizzle-orm";
import { DAY_MS } from "@tinkerbell/core";
import { bandwidthSamples, bandwidthTests, type Db } from "@tinkerbell/db";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

export type BandwidthTest = InferSelectModel<typeof bandwidthTests>;

/** How long a result stays interesting. Longer than health checks: a link's speed is a slow-moving fact. */
const RETENTION_MS = 90 * DAY_MS;

// ─── Live usage samples ─────────────────────────────────────────────────────

/**
 * How much usage history is kept.
 *
 * A week at one row per 30s poll is ~20k rows — small, and long enough to
 * answer "is Sunday evening always like this?", which a day of history can't.
 */
const SAMPLE_RETENTION_MS = 7 * DAY_MS;

export interface StoreDeps {
  db: Db;
}
export const createStore = perDeps(function createStore(deps: StoreDeps) {
  const { db } = deps;

  function recordBandwidthTest(row: InferInsertModel<typeof bandwidthTests>): void {
    db.insert(bandwidthTests).values(row).run();
  }

  /** The most recent successful test, or null if there has never been one. */
  function getLatestBandwidthTest(): BandwidthTest | null {
    return (
      db
        .select()
        .from(bandwidthTests)
        .where(sql`${bandwidthTests.status} = 'ok'`)
        .orderBy(desc(bandwidthTests.startedAt))
        .limit(1)
        .get() ?? null
    );
  }

  /** Every test since `since`, oldest first — the history chart. */
  function getBandwidthHistory(since: number, limit = 50): BandwidthTest[] {
    const rows = db
      .select()
      .from(bandwidthTests)
      .where(gte(bandwidthTests.startedAt, since))
      .orderBy(desc(bandwidthTests.startedAt))
      .limit(limit)
      .all();
    return rows.reverse();
  }

  /** Recent successful upload figures, newest first — the regression baseline. */
  function recentUpMbps(limit = 5): number[] {
    return db
      .select({ upMbps: bandwidthTests.upMbps })
      .from(bandwidthTests)
      .where(sql`${bandwidthTests.status} = 'ok' and ${bandwidthTests.upMbps} is not null`)
      .orderBy(desc(bandwidthTests.startedAt))
      .limit(limit)
      .all()
      .map((r) => r.upMbps ?? 0);
  }

  /**
   * Record what was streaming at this instant.
   *
   * `sampledAt` is the primary key and the poll's own timestamp, so a retried or
   * doubled tick overwrites its own row rather than adding a second reading for
   * the same moment and doubling that bucket's peak.
   */
  function recordBandwidthSample(sample: { sampledAt: number; kbps: number; streams: number }): void {
    db.insert(bandwidthSamples)
      .values(sample)
      .onConflictDoUpdate({
        target: bandwidthSamples.sampledAt,
        set: { kbps: sample.kbps, streams: sample.streams },
      })
      .run();
  }

  /**
   * Recent usage as `buckets` equal slices of `spanMs`, oldest first, in kbps.
   *
   * Each bucket is its **peak**, not its mean. The question a usage history
   * answers is whether the link had room, and an hour averaging 20 Mbps with one
   * minute at 400 is not an hour with room — averaging is exactly the operation
   * that hides the only moment worth seeing.
   *
   * Buckets with no samples read zero. On an install that has been up for an
   * hour that makes most of the series a claim about time we weren't watching;
   * it is also indistinguishable from "nobody streamed", which is what it
   * usually is.
   */
  function getBandwidthSeries(buckets: number, spanMs: number, now: number = Date.now()): number[] {
    const bucketMs = Math.floor(spanMs / buckets);
    const start = now - spanMs;
    const rows = db
      .select({
        bucket: sql<number>`cast((${bandwidthSamples.sampledAt} - ${start}) / ${bucketMs} as integer)`,
        kbps: sql<number>`max(${bandwidthSamples.kbps})`,
      })
      .from(bandwidthSamples)
      .where(gte(bandwidthSamples.sampledAt, start))
      .groupBy(sql`1`)
      .all();

    const series: number[] = Array.from({ length: buckets }, () => 0);
    for (const row of rows) {
      if (row.bucket >= 0 && row.bucket < buckets) series[row.bucket] = row.kbps;
    }
    return series;
  }

  /** Keep the samples table from growing unbounded. Called from `purge-runs`. */
  function pruneBandwidthSamples(): number {
    const cutoff = Date.now() - SAMPLE_RETENTION_MS;
    return db
      .delete(bandwidthSamples)
      .where(sql`${bandwidthSamples.sampledAt} < ${cutoff}`)
      .run().changes;
  }

  /** Keep the table from growing unbounded. Called from `purge-runs`. */
  function pruneBandwidthTests(): number {
    const cutoff = Date.now() - RETENTION_MS;
    return db
      .delete(bandwidthTests)
      .where(sql`${bandwidthTests.startedAt} < ${cutoff}`)
      .run().changes;
  }

  return {
    recordBandwidthTest,
    getLatestBandwidthTest,
    getBandwidthHistory,
    recentUpMbps,
    recordBandwidthSample,
    getBandwidthSeries,
    pruneBandwidthSamples,
    pruneBandwidthTests,
  };
});
