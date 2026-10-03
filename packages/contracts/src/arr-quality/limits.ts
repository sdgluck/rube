/**
 * Size limits, in the units people think in.
 *
 * Radarr and Sonarr bound size in **MB per minute of runtime**, per quality.
 * Nobody thinks in MB/min. They think "a film shouldn't be more than 15 GB" or
 * "an hour of TV, about 4 GB". So the user states a size for a reference
 * runtime, and everything the *Arr is told is derived from that one number.
 * The browser needs the same arithmetic for its live preview ("a 3 h film
 * ≤ 22.5 GB"), which is why it lives here rather than in the planner.
 */

import { z } from "zod";

/** The *Arr UIs' own slider ceilings. Writing above them is rejected. */
export const QUALITY_DEFINITION_MAX_MB_PER_MIN = { radarr: 2000, sonarr: 1000 } as const;

export const sizeLimitSchema = z.object({
  /** The size a release of `basisMinutes` runtime may reach. */
  maxGb: z.number().positive().max(500),
  /** 120 for a film, 60 for "an hour of TV". */
  basisMinutes: z.number().int().min(10).max(600),
  /**
   * An absolute per-file ceiling for *this profile only*, enforced by a `Size`
   * custom format. `null` turns it off.
   *
   * Separate from `maxGb` because the two layers do different jobs: the
   * per-minute rate goes into the instance-wide quality definitions and scales
   * with runtime, and the ceiling is what keeps a compact profile compact when
   * a looser profile on the same instance has loosened those definitions.
   */
  // Below 1000, the top of the size format's own range, so min < max holds.
  ceilingGb: z.number().positive().max(999).nullable(),
});

export type SizeLimit = z.infer<typeof sizeLimitSchema>;

/**
 * How much headroom the ceiling gets over the reference size by default.
 *
 * A quarter covers a two-and-a-half-hour film against a two-hour basis.
 * Anything longer is still bounded by the per-minute rate. Only the
 * absolute cap stops at this.
 */
export const DEFAULT_CEILING_FACTOR = 1.25;

export function defaultCeiling(maxGb: number): number {
  return roundGb(maxGb * DEFAULT_CEILING_FACTOR);
}

/** The per-minute rate a limit implies, in the *Arr's own unit. */
export function mbPerMinute(limit: Pick<SizeLimit, "maxGb" | "basisMinutes">): number {
  return round1((limit.maxGb * 1024) / limit.basisMinutes);
}

/** What a given runtime may weigh at a given rate, in GB. */
export function gbForRuntime(mbPerMin: number, minutes: number): number {
  return roundGb((mbPerMin * minutes) / 1024);
}

/** The smallest `maxGb` that leaves every allowed quality's minimum reachable. */
export function minimumMaxGb(minMbPerMin: number, basisMinutes: number): number {
  return Math.ceil(((minMbPerMin * basisMinutes) / 1024) * 2) / 2;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function roundGb(n: number): number {
  return Math.round(n * 10) / 10;
}
