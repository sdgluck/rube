/**
 * Bandwidth test: how fast is the link the remote streams contend for.
 *
 * Measured against Cloudflare's public speed endpoints — no key, no account,
 * and an anycast edge that is close to almost everyone. What this measures is
 * the *Tinkerbell host's* internet connection, not the browser's and not the
 * LAN path to Plex. That is the deliberate choice: serving a remote stream is
 * this host uploading, so its upload figure is the capacity the Stats tile
 * divides live session bandwidth by.
 *
 * Every transfer here is bounded twice over — by a byte ceiling, so someone on
 * a metered connection can predict the cost, and by the caller's deadline, so
 * a stalled socket can't outlive the job.
 */
import { randomFillSync, randomUUID } from "node:crypto";
import { errorMessage, getPlexClient, type JobContext } from "@tinkerbell/core";
import { emitEvent } from "@tinkerbell/domain.events";
import {
  isSlowerThanUsual,
  MAX_CHUNK_BYTES,
  meanAbsoluteDeviation,
  median,
  summarise,
  throughputMbps,
} from "./math.ts";
import { recentUpMbps, recordBandwidthTest } from "./store.ts";
import { download, ENDPOINT, LATENCY_PROBES, runPhase, STREAMS, upload } from "./transfer.ts";

export { getBandwidthHistory, getLatestBandwidthTest, pruneBandwidthTests, type BandwidthTest } from "./store.ts";
export { isSlowerThanUsual, summarise, throughputMbps } from "./math.ts";
export { runPhase } from "./transfer.ts";

/** Whole-test budget. Each phase also stops on its own byte and time ceilings. */
const TOTAL_BUDGET_MS = 90_000;

// Byte ceilings, deliberately modest. Cloudflare polices these endpoints by
// payload size: a handful of 200 MB+ runs earned a 429 on every `__down` of
// 10 MB or more — while 1 MB downloads and uploads still returned 200 — and it
// stayed that way for a quarter of an hour. 120 MB is several seconds of
// measurement on a gigabit link, which is all the accuracy this number needs.
const DOWN_CAP_BYTES = 120_000_000;
const UP_CAP_BYTES = 80_000_000;

/** Worst case, quoted in the UI so the cost isn't a surprise. Both ceilings are real. */
export const MAX_TRANSFER_BYTES = DOWN_CAP_BYTES + UP_CAP_BYTES;

/**
 * Median TTFB and its jitter, from zero-byte responses.
 *
 * One extra probe is taken and the first discarded: it pays for DNS, the TCP
 * handshake and the TLS handshake, which is a one-off cost of asking rather
 * than a property of the link — left in, it lands in the jitter figure as
 * permanent instability that isn't there.
 */
async function measureLatency(deadline: AbortSignal): Promise<{ latencyMs: number | null; jitterMs: number | null }> {
  const samples: number[] = [];
  for (let i = 0; i <= LATENCY_PROBES; i++) {
    if (deadline.aborted) break;
    const started = performance.now();
    const res = await fetch(`${ENDPOINT}/__down?bytes=0`, { signal: deadline });
    const ttfb = performance.now() - started;
    await res.arrayBuffer();
    // Cloudflare reports its own processing time; the part we care about is
    // the round trip, so take that back off when the header is present.
    const serverMs = Number(/dur=([\d.]+)/.exec(res.headers.get("server-timing") ?? "")?.[1] ?? 0);
    samples.push(Math.max(0, ttfb - (Number.isFinite(serverMs) ? serverMs : 0)));
  }
  // A run cancelled before any probe landed has *no* latency, which is not the
  // same fact as a latency of zero — and `median([])` is 0.
  const measured = samples.slice(1);
  if (measured.length === 0) return { latencyMs: null, jitterMs: null };
  return { latencyMs: median(measured), jitterMs: meanAbsoluteDeviation(measured) };
}

/** Live session bandwidth in kbps, or 0 if Plex isn't reachable/configured. */
async function concurrentStreamKbps(): Promise<number> {
  try {
    const sessions = await getPlexClient().getActiveSessions();
    return sessions.reduce((sum, s) => sum + (s.bandwidth ?? 0), 0);
  } catch {
    // The bandwidth test does not need Plex to be healthy to be useful.
    return 0;
  }
}

/**
 * The `bandwidth-test` internal job. Writes exactly one row — including when
 * it fails part-way, so "download fine, upload timed out" survives as a fact.
 */
export async function runBandwidthTest(ctx: JobContext): Promise<string> {
  const id = randomUUID();
  const startedAt = Date.now();
  const deadline = AbortSignal.any([ctx.signal, AbortSignal.timeout(TOTAL_BUDGET_MS)]);

  const concurrentKbps = await concurrentStreamKbps();
  if (concurrentKbps > 0) {
    ctx.log(`Warning: ${(concurrentKbps / 1000).toFixed(1)} Mbps of playback is in flight — results will be lower.`);
  }

  let downMbps: number | null = null;
  let upMbps: number | null = null;
  let latencyMs: number | null = null;
  let jitterMs: number | null = null;
  let bytesDown = 0;
  let bytesUp = 0;
  let pop: string | null = null;

  const finish = (status: "ok" | "error" | "cancelled", error: string | null) => {
    recordBandwidthTest({
      id,
      downMbps,
      upMbps,
      latencyMs,
      jitterMs,
      endpoint: ENDPOINT,
      pop,
      streams: STREAMS,
      bytesDown,
      bytesUp,
      status,
      error,
      concurrentKbps,
      startedAt,
      finishedAt: Date.now(),
    });
  };

  try {
    ctx.progress(0, 3, "Measuring latency");
    const latency = await measureLatency(deadline);
    latencyMs = latency.latencyMs;
    jitterMs = latency.jitterMs;
    if (latencyMs != null) ctx.log(`Latency ${latencyMs.toFixed(0)} ms (jitter ${jitterMs?.toFixed(0)} ms)`);

    ctx.progress(1, 3, "Measuring download");
    const down = await runPhase(DOWN_CAP_BYTES, download, deadline);
    bytesDown = down.movedBytes;
    pop ??= down.pop;
    downMbps = throughputMbps(down.measuredBytes, down.measuredMs);
    ctx.log(`Download ${downMbps.toFixed(1)} Mbps (${(bytesDown / 1e6).toFixed(0)} MB moved)`);

    ctx.progress(2, 3, "Measuring upload");
    // One buffer, reused: the payload is random so it can't be compressed in
    // transit, and re-randomising it per request would measure the CPU.
    const payload = randomFillSync(new Uint8Array(MAX_CHUNK_BYTES));
    const up = await runPhase(UP_CAP_BYTES, (size, signal) => upload(payload.subarray(0, size), signal), deadline);
    bytesUp = up.movedBytes;
    pop ??= up.pop;
    upMbps = throughputMbps(up.measuredBytes, up.measuredMs);
    ctx.log(`Upload ${upMbps.toFixed(1)} Mbps (${(bytesUp / 1e6).toFixed(0)} MB moved)`);
    ctx.progress(3, 3, "Done");
  } catch (err) {
    // A cancel is a decision, not a fault: record what was measured and say so
    // rather than failing the run.
    if (ctx.signal.aborted) {
      finish("cancelled", null);
      return `Bandwidth test cancelled — ${summarise({ downMbps, upMbps, latencyMs, pop })}`;
    }
    // The whole-test deadline aborts the same way a cancel does, and its
    // AbortError says only "This operation was aborted" — which reads as a
    // mystery rather than as the budget doing its job.
    const message = deadline.aborted ? `no result within ${TOTAL_BUDGET_MS / 1000}s` : errorMessage(err);
    finish("error", message);
    throw new Error(`Bandwidth test failed: ${message}`);
  }

  // Baseline is read before the new row is written, so it can't include itself.
  const baseline = recentUpMbps();
  finish("ok", null);

  const summary = summarise({ downMbps, upMbps, latencyMs, pop });
  const regressed = upMbps != null && isSlowerThanUsual(upMbps, baseline);
  emitEvent("bandwidth.tested", regressed ? `${summary} — slower than usual` : summary, {
    downMbps,
    upMbps,
    latencyMs,
    regressed,
  });

  return summary;
}
