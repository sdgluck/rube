/**
 * The arithmetic behind a bandwidth test, kept apart from the transfers so it
 * can be tested without a network. Everything here is pure.
 */

/** Bytes moved over a wall-clock window, as megabits per second. */
export function throughputMbps(bytes: number, elapsedMs: number): number {
  if (elapsedMs <= 0 || bytes <= 0) return 0;
  return (bytes * 8) / (elapsedMs / 1000) / 1_000_000;
}

/** Median, by sorting a copy — the sample sizes here are single digits. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Jitter as the mean absolute deviation from the median.
 *
 * Standard deviation would be the textbook answer; MAD is used because one
 * probe landing on a garbage-collection pause or a retransmit shouldn't
 * dominate the number an admin reads as "how steady is this link".
 */
export function meanAbsoluteDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const center = median(values);
  return values.reduce((sum, v) => sum + Math.abs(v - center), 0) / values.length;
}

/** Per-stream payload bounds for a measured round. */
export const MIN_CHUNK_BYTES = 256_000;
export const MAX_CHUNK_BYTES = 25_000_000;
/** How long one round should take. Long enough to average over, short enough to steer. */
const ROUND_TARGET_MS = 2_000;

/**
 * How many bytes each stream should ask for next, given the rate observed so
 * far and how many streams run at once.
 *
 * Fixed payload sizes are the obvious thing and the wrong thing: 25 MB across
 * four streams is two seconds on a gigabit line and thirteen minutes on a
 * 1 Mbps one — long past any deadline, so the connections that most need
 * measuring are exactly the ones whose test would abort mid-round. Sizing each
 * round from the previous one's rate keeps a round at roughly
 * `ROUND_TARGET_MS` on any link.
 *
 * The observed rate is per-stream, and parallel streams share the same pipe,
 * so the per-stream ask is divided by the stream count rather than assuming
 * each new connection finds fresh capacity.
 */
export function nextChunkBytes(bytesPerSec: number, streams: number): number {
  if (!(bytesPerSec > 0) || streams < 1) return MIN_CHUNK_BYTES;
  const perStream = (bytesPerSec * (ROUND_TARGET_MS / 1000)) / streams;
  return Math.round(Math.min(MAX_CHUNK_BYTES, Math.max(MIN_CHUNK_BYTES, perStream)));
}

/** How much slower than usual a result has to be before it's worth an event. */
const REGRESSION_RATIO = 0.7;

/**
 * True when `current` is more than 30% below the median of `history`.
 *
 * Compared against the median rather than the previous run so that one bad
 * test — someone streaming, an overloaded PoP — doesn't first fire a false
 * alarm and then re-baseline the alarm away on the run after it.
 */
export function isSlowerThanUsual(current: number, history: number[]): boolean {
  const usable = history.filter((v) => v > 0);
  if (usable.length < 3 || current <= 0) return false;
  return current < median(usable) * REGRESSION_RATIO;
}

/** `↓ 94.2 Mbps ↑ 18.1 Mbps · 12 ms · LHR` — the job run's message line. */
export function summarise(result: {
  downMbps: number | null;
  upMbps: number | null;
  latencyMs: number | null;
  pop: string | null;
}): string {
  const parts: string[] = [];
  if (result.downMbps != null) parts.push(`↓ ${result.downMbps.toFixed(1)} Mbps`);
  if (result.upMbps != null) parts.push(`↑ ${result.upMbps.toFixed(1)} Mbps`);
  const tail: string[] = [];
  if (result.latencyMs != null) tail.push(`${Math.round(result.latencyMs)} ms`);
  if (result.pop) tail.push(result.pop);
  const head = parts.length > 0 ? parts.join(" ") : "No measurement";
  return tail.length > 0 ? `${head} · ${tail.join(" · ")}` : head;
}
