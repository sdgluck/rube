/**
 * The transfers themselves, and the budget arithmetic that decides when to
 * stop making them.
 *
 * Kept apart from `index.ts` so it can be tested without pulling in the
 * database: `@tinkerbell/db` opens its SQLite connection at import time, and a
 * unit test of "does a phase use its byte budget" has no business creating a
 * database file to answer that.
 */
import { MIN_CHUNK_BYTES, nextChunkBytes } from "./math.ts";

export const ENDPOINT = "https://speed.cloudflare.com";

/** Parallel connections. One TCP stream measures one stream's fair share, not the link. */
export const STREAMS = 4;

/**
 * A single warm-up transfer, discarded: TLS setup and TCP slow-start land here
 * rather than in the number, and its rate is what sizes the first real round.
 * One stream, not four, so a slow link doesn't spend the whole budget warming up.
 */
export const WARMUP_BYTES = 1_000_000;

/**
 * Measurement window per phase.
 *
 * The byte ceilings passed to `runPhase` only bind on a fast link — a 10 Mbps
 * connection stops here having moved ~12 MB. So the cost of a test scales with
 * the bandwidth available to absorb it, which is the right way round.
 */
export const MEASURE_MS = 10_000;

export const LATENCY_PROBES = 6;

export interface Transfer {
  bytes: number;
  pop: string | null;
}

export interface PhaseResult {
  /** Bytes and wall-clock the throughput figure is computed from (warm-up excluded). */
  measuredBytes: number;
  measuredMs: number;
  /** Everything actually moved, warm-up included — what the run cost. */
  movedBytes: number;
  pop: string | null;
}

/**
 * Turn a failed response into a message worth reading.
 *
 * Throttling gets its own wording because it is the one failure a user causes
 * and can fix. The endpoints are free and shared, and repeated full runs are
 * enough to be pushed back on — 429 on the larger payloads, sometimes 403,
 * while small requests keep succeeding. A standing 403 on a public, keyless
 * endpoint means the same thing as the 429 did, so they read the same. It
 * clears on its own, but in fifteen minutes rather than one.
 */
export function assertOk(res: Response, what: string): void {
  if (res.ok) return;
  if (res.status === 429 || res.status === 403) {
    throw new Error("Cloudflare is throttling this server — wait about fifteen minutes and run the test again");
  }
  throw new Error(`${what} → ${res.status} ${res.statusText}`);
}

export async function download(bytes: number, deadline: AbortSignal): Promise<Transfer> {
  const res = await fetch(`${ENDPOINT}/__down?bytes=${bytes}`, { signal: deadline });
  assertOk(res, "GET /__down");
  const pop = res.headers.get("cf-meta-colo");

  // Read incrementally rather than buffering: bytes are counted as they land,
  // and an abort mid-transfer interrupts here instead of after the full body.
  let received = 0;
  const reader = res.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
    }
  }
  return { bytes: received, pop };
}

// The buffer type parameter is load-bearing: `fetch` accepts a view over a
// plain ArrayBuffer, and a bare `Uint8Array` widens to `ArrayBufferLike`
// (which includes SharedArrayBuffer) and won't type as a body.
export async function upload(payload: Uint8Array<ArrayBuffer>, deadline: AbortSignal): Promise<Transfer> {
  const res = await fetch(`${ENDPOINT}/__up`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: payload,
    signal: deadline,
  });
  assertOk(res, "POST /__up");
  // Drain so the connection is reusable by the next round.
  await res.arrayBuffer();
  return { bytes: payload.byteLength, pop: res.headers.get("cf-meta-colo") };
}

/**
 * Run `STREAMS` transfers at a time until the phase runs out of time or
 * budget, sizing each round from the rate the previous one saw.
 *
 * Wall-clock is measured per round across all streams, so per-request setup is
 * charged to the result — which under-reports slightly, and is the honest
 * direction to be wrong in.
 *
 * The clock is an argument so the budget arithmetic can be tested against a
 * simulated link of a known speed. Every bug this loop has had — rounds that
 * outlived the deadline, a cap overshot by a full round, a cap left
 * four-fifths unused — was a mistake in *when it stops*, which is exactly what
 * a live run against Cloudflare can only show you by accident.
 */
export async function runPhase(
  capBytes: number,
  transfer: (size: number, deadline: AbortSignal) => Promise<Transfer>,
  deadline: AbortSignal,
  now: () => number = performance.now,
): Promise<PhaseResult> {
  const warmStarted = now();
  const warmup = await transfer(WARMUP_BYTES, deadline);
  let bytesPerSec = (warmup.bytes / Math.max(1, now() - warmStarted)) * 1000;
  let movedBytes = warmup.bytes;
  let pop: string | null = warmup.pop;

  let measuredBytes = 0;
  let measuredMs = 0;
  while (measuredMs < MEASURE_MS && !deadline.aborted) {
    // The ceiling is enforced against what the *next* round would move, not
    // what previous ones already did — otherwise a cap is only ever noticed
    // after being blown through by a whole round, and the figure quoted to the
    // user is a fifth short of what the test actually costs.
    //
    // The last round is trimmed to the remaining budget rather than skipped.
    // Skipping it wastes most of the cap on a fast link: a gigabit connection
    // took one 24 MB round, found the next projected past the ceiling, and
    // reported a figure measured over four tenths of a second.
    const remaining = capBytes - movedBytes;
    if (remaining < MIN_CHUNK_BYTES * STREAMS) break;
    const size = Math.min(nextChunkBytes(bytesPerSec, STREAMS), Math.floor(remaining / STREAMS));

    const started = now();
    const results = await Promise.all(Array.from({ length: STREAMS }, () => transfer(size, deadline)));
    const elapsed = now() - started;
    measuredMs += elapsed;
    let roundBytes = 0;
    for (const t of results) {
      roundBytes += t.bytes;
      pop ??= t.pop;
    }
    measuredBytes += roundBytes;
    movedBytes += roundBytes;
    // Steer the next round off this one's aggregate rate.
    bytesPerSec = (roundBytes / Math.max(1, elapsed)) * 1000;
  }

  return { measuredBytes, measuredMs, movedBytes, pop };
}
