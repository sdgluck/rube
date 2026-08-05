/**
 * The one fixed instant the whole capture runs at.
 *
 * Screenshots are committed and regenerated on every UI change, so an unchanged
 * page has to produce a byte-identical PNG — otherwise git fills up with diffs
 * that mean nothing. Anything derived from the wall clock breaks that: "6m ago"
 * becomes "7m ago", server uptime ticks, `addedAt` sorting drifts.
 *
 * Three places read this constant and must agree:
 *   - `seed.ts`, so stored timestamps are stable
 *   - `freeze-clock.mjs`, preloaded into the server so `uptimeSec` is stable
 *   - `capture.ts`, via `page.clock.setFixedTime`, so the browser agrees
 *
 * Chosen to sit in the middle of a weekday, well away from midnight and from
 * either DST boundary, so no formatter lands on an edge case.
 */
export const FIXED_NOW = Date.UTC(2025, 5, 15, 12, 0, 0);

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/**
 * FNV-1a. Used where the fixtures want scattered-looking values (an `addedAt`
 * spread over a month, say) that are nevertheless identical on every run.
 */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
