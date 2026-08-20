/**
 * Ordering and summarising what the indexers came back with.
 *
 * The *Arrs send a `releaseWeight`, but only Radarr does and it encodes that
 * application's own preference ordering, not the one a person scanning a table
 * wants. Sorting here means one rule for both services, and a rule that can be
 * tested — which matters, because "the best release is at the top" is the only
 * reason anyone reads this list rather than letting the *Arr choose.
 */

export interface ReleaseRow {
  guid: string;
  title: string;
  indexer?: string;
  size?: number;
  seeders?: number;
  leechers?: number;
  ageHours?: number;
  protocol?: string;
  quality?: { quality?: { name?: string } };
  customFormatScore?: number;
  rejected?: boolean;
  rejections?: string[];
  /**
   * Everything else the *Arr sent.
   *
   * A grab posts the release object back **verbatim** — the *Arr matches on
   * the whole payload, not on the guid — so the fields this file has no
   * opinion about still have to survive the round trip.
   */
  [extra: string]: unknown;
}

/**
 * Best first.
 *
 * Rejected releases sink to the bottom rather than disappearing: the *Arr will
 * refuse them, but overriding that refusal is precisely why an interactive
 * search exists, and a release you cannot see is one you cannot override.
 */
export function sortReleases<T extends ReleaseRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (!!a.rejected !== !!b.rejected) return a.rejected ? 1 : -1;
    const score = (b.customFormatScore ?? 0) - (a.customFormatScore ?? 0);
    if (score !== 0) return score;
    const seeders = (b.seeders ?? 0) - (a.seeders ?? 0);
    if (seeders !== 0) return seeders;
    return (b.size ?? 0) - (a.size ?? 0);
  });
}

const HOURS_PER_DAY = 24;
const HOURS_PER_MONTH = 24 * 30;
const HOURS_PER_YEAR = 24 * 365;

/**
 * How old a release is, at the precision that changes a decision.
 *
 * Nobody picks between a 47-day-old release and a 48-day-old one, so the units
 * get coarser as the number gets bigger rather than the digits getting longer.
 */
export function releaseAge(ageHours: number | undefined): string {
  if (ageHours === undefined || !Number.isFinite(ageHours) || ageHours < 0) return "—";
  if (ageHours < 1) return "<1h";
  if (ageHours < HOURS_PER_DAY) return `${Math.floor(ageHours)}h`;
  if (ageHours < HOURS_PER_MONTH) return `${Math.floor(ageHours / HOURS_PER_DAY)}d`;
  if (ageHours < HOURS_PER_YEAR) return `${Math.floor(ageHours / HOURS_PER_MONTH)}mo`;
  return `${Math.floor(ageHours / HOURS_PER_YEAR)}y`;
}

/**
 * Why the *Arr would refuse this.
 *
 * The first reason plus a count. A release can carry a dozen rejections and
 * the first is almost always the one that matters; the count is there so the
 * table does not pretend there was only one.
 */
export function rejectionSummary(rejections: string[] | undefined): string | null {
  if (!rejections || rejections.length === 0) return null;
  const [first, ...rest] = rejections;
  return rest.length > 0 ? `${first} (+${rest.length} more)` : first;
}

export function protocolLabel(protocol: string | undefined): string {
  if (protocol === "usenet") return "Usenet";
  if (protocol === "torrent") return "Torrent";
  return protocol || "—";
}

export function qualityLabel(row: ReleaseRow): string {
  return row.quality?.quality?.name || "—";
}
