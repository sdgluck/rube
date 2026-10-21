/**
 * A `Digest` rendered into the one message shape every destination speaks.
 *
 * **On poster images.** The plan this was built from expected to pull poster
 * URLs from TMDb, on the grounds that `tmdb_cache` "already holds details per
 * item". It doesn't, twice over: the cache is keyed by TMDb id with no stored
 * mapping from a Plex rating key, and `TmdbCachedDetails` carries genres, cast
 * and keywords but no image path at all. The remaining option was Plex's own
 * thumbs through `/api/plex-image`, which lives on the admin port and is
 * loopback-bound by default — a Discord embed pointing at it shows a broken
 * image for almost everyone, and exposing that proxy publicly to fix it is
 * explicitly not something to do for a prettier newsletter.
 *
 * So: no images, rather than broken ones. `DigestItem.imageUrl` and
 * `RichMessage.imageUrl` are plumbed end to end and every renderer already
 * handles them, so whenever a public poster source does exist this becomes a
 * one-line change in `build.ts` rather than a change here.
 */
import type { DigestBlock, RichMessage } from "@rube/domain.notifications";
import type { Digest, DigestItem } from "./build.ts";

export interface RenderOptions {
  /** Whose digest this is. Absent for the server-wide one. */
  username?: string;
  /** Server name for the subject line, when one is known. */
  serverName?: string;
}

const MONTH_DAY = { day: "numeric", month: "short" } as const;

function formatPeriod(since: number, until: number): string {
  const fmt = new Intl.DateTimeFormat("en-GB", MONTH_DAY);
  // `until` is exclusive, so the last day the digest covers is the one before
  // it — a Monday-to-Monday window reads as "8 Jul – 14 Jul", not "– 15 Jul".
  return `${fmt.format(new Date(since))} – ${fmt.format(new Date(until - 1))}`;
}

function itemLine(item: DigestItem): string {
  const year = item.year ? ` (${item.year})` : "";
  if (item.plays != null) {
    const plays = item.plays === 1 ? "1 play" : `${item.plays} plays`;
    return `${item.title}${year} — ${plays}`;
  }
  if (item.runsRemaining != null) {
    return `${item.title}${year} — ${item.runsRemaining === 0 ? "goes on the next run" : "one more run"}`;
  }
  return `${item.title}${year}`;
}

/** The headline sentence, which is all most people read. */
function summaryLine(digest: Digest, options: RenderOptions): string {
  const { itemsAdded, hoursWatched, activeUsers } = digest.stats;
  const parts: string[] = [];

  if (options.username) {
    // A user's digest leads with what's for them, not with server totals.
    parts.push(
      digest.added.length === 1 ? "1 new thing you might like" : `${digest.added.length} new things you might like`,
    );
    if (digest.watched.length > 0) {
      parts.push(digest.watched.length === 1 ? "1 title you watched" : `${digest.watched.length} titles you watched`);
    }
  } else {
    parts.push(itemsAdded === 1 ? "1 item added" : `${itemsAdded} items added`);
    if (hoursWatched > 0) parts.push(`${hoursWatched} hours watched`);
    if (activeUsers > 0) parts.push(activeUsers === 1 ? "1 active viewer" : `${activeUsers} active viewers`);
  }

  return parts.join(" · ");
}

function block(heading: string, items: DigestItem[]): DigestBlock | null {
  if (items.length === 0) return null;
  return { heading, lines: items.map(itemLine) };
}

export function renderDigest(digest: Digest, options: RenderOptions = {}): RichMessage {
  const period = formatPeriod(digest.period.since, digest.period.until);
  const who = options.username ? `${options.username}, here's` : "Here's";
  const server = options.serverName ? ` on ${options.serverName}` : "";

  const blocks = [
    block(options.username ? "New for you" : "Added", digest.added),
    block(options.username ? "You watched" : "Most watched", options.username ? digest.watched : digest.topTitles),
    digest.newCollections.length > 0 ? { heading: "New collections", lines: digest.newCollections } : null,
    // Last, and always included when non-empty: it is the only section with a
    // deadline attached, so it should be the thing left on screen.
    block("Leaving soon", digest.leavingSoon),
  ].filter((b): b is DigestBlock => b !== null);

  return {
    title: `${options.serverName ? `${options.serverName}: ` : ""}your library, ${period}`,
    text: `${who} what happened${server} between ${period}.\n${summaryLine(digest, options)}`,
    blocks,
    data: {
      period: digest.period,
      userId: digest.userId,
      stats: digest.stats,
      added: digest.added,
      watched: digest.watched,
      topTitles: digest.topTitles,
      newCollections: digest.newCollections,
      leavingSoon: digest.leavingSoon,
    },
  };
}
