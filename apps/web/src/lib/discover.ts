/**
 * The judgements the Discover grid makes about a search result.
 *
 * Extracted from the page because `apps/web`'s test glob is `*.test.ts` and
 * there is no DOM: what can be tested is what can be pulled out of the
 * renderer. These three are worth pulling out — "do I already have this" is
 * the whole value of the page, and it is exactly the kind of thing that
 * regresses silently inside a `.map()`.
 */

import type { ArrService } from "@tinkerbell/contracts";
import type { StatusChipTone } from "#components/PageShell";

export interface DiscoverArrHolding {
  instanceId: string;
  arrId: number;
  monitored: boolean;
  hasFile: boolean;
}

export interface DiscoverResult {
  tmdbId: number;
  mediaType: "movie" | "tv";
  service: ArrService;
  title: string;
  year: number | null;
  overview: string;
  posterPath: string | null;
  inArr: DiscoverArrHolding[];
  plexRatingKey: string | null;
}

export interface PresenceBadge {
  label: string;
  tone: StatusChipTone;
}

/**
 * What the chip on a card says.
 *
 * Ordered by what the person looking at it wants to know first. "It's in Plex"
 * ends the question. "It's in an *Arr but not on disk" means it is coming.
 * Anything else is an Add button, so this returns null and the card renders one.
 */
export function presenceBadge(
  result: {
    inArr: DiscoverArrHolding[];
    plexRatingKey: string | null;
  },
  instanceName?: (id: string) => string,
): PresenceBadge | null {
  if (result.plexRatingKey) return { label: "In Plex", tone: "ok" };
  if (result.inArr.length === 0) return null;
  if (result.inArr.length > 1) return { label: `In ${result.inArr.length} instances`, tone: "advisory" };

  const [only] = result.inArr;
  const where = instanceName?.(only.instanceId) ?? only.instanceId;
  if (only.hasFile) return { label: `In ${where}`, tone: "ok" };
  if (!only.monitored) return { label: `Unmonitored in ${where}`, tone: "advisory" };
  return { label: `Wanted in ${where}`, tone: "running" };
}

/**
 * Whether the Add button is offered.
 *
 * Only the *Arr matters, not Plex: a film Plex has but no *Arr manages is
 * exactly the thing somebody might want to start managing. Presence in an
 * *Arr already has its own link to the record.
 */
export function canAdd(result: { inArr: DiscoverArrHolding[] }, configured: boolean): boolean {
  return configured && result.inArr.length === 0;
}

/**
 * Where a result's existing record lives, for the link the card renders
 * instead of an Add button. Null when it is held in more than one instance —
 * there is no single right destination, so the card links to the filtered
 * library list instead.
 */
export function holdingLink(result: DiscoverResult): string | null {
  if (result.inArr.length !== 1) return null;
  const [only] = result.inArr;
  const kind = result.mediaType === "movie" ? "movies" : "series";
  return `/arrs/${only.instanceId}/${kind}/${only.arrId}`;
}

/** The unified library, filtered to what this result is — the multi-instance fallback. */
export function libraryLink(result: DiscoverResult): string {
  return result.mediaType === "movie" ? "/movies" : "/tv";
}

/**
 * The add dialog's opening state.
 *
 * First profile and first *accessible* root folder: an inaccessible one is a
 * misconfiguration on the *Arr's side and choosing it by default turns the
 * add into a failure with a confusing message.
 */
export function addDefaults(
  profiles: Array<{ id: number }> | undefined,
  folders: Array<{ path: string; accessible?: boolean }> | undefined,
): { qualityProfileId: number | null; rootFolderPath: string | null } {
  const folder = (folders ?? []).find((f) => f.accessible !== false) ?? (folders ?? [])[0];
  return {
    qualityProfileId: profiles?.[0]?.id ?? null,
    rootFolderPath: folder?.path ?? null,
  };
}
