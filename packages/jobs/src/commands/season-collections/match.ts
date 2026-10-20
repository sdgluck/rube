/**
 * The parts of Season Collections that are decisions rather than I/O: which
 * titles belong to a season, in what order, and which existing row is whose.
 * Kept apart from the command so each can be tested without a Plex server.
 */
import type { TmdbCachedDetails } from "@tinkerbell/db";
import { z } from "zod";
import { extractJSON } from "../ai-collection-shared.ts";

export const SEASON_LABEL = "SeasonCollections";
/** Which season a row is for. Found by label, not title, so renaming a season edits its row instead of orphaning it. */
export const SEASON_KEY_PREFIX = "Season:";

/** A keyword the title is filed under, and nothing weaker — see `seasons.ts` for what the release month got wrong. */
export function matchSeason(details: TmdbCachedDetails | undefined, keywordIds: ReadonlySet<number>): boolean {
  return (details?.keywords ?? []).some((id) => keywordIds.has(id));
}

export interface RankInfo {
  rating: number | null;
  year: number | null;
}

/**
 * Best first, for a row with no taste to order it by: rating, then newest,
 * then rating key. Fully determined, so a daily run that finds the same
 * titles writes the same row and the diff against Plex is empty.
 */
export function rankCandidates(keys: Iterable<string>, info: ReadonlyMap<string, RankInfo>): string[] {
  return [...new Set(keys)].sort((a, b) => {
    const ia = info.get(a);
    const ib = info.get(b);
    const ra = ia?.rating ?? -1;
    const rb = ib?.rating ?? -1;
    if (ra !== rb) return rb - ra;
    const ya = ia?.year ?? 0;
    const yb = ib?.year ?? 0;
    if (ya !== yb) return yb - ya;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** Which season a row is for, and whose it is (`null` for a row everyone sees). */
export function rowIdentity(labels: string[]): { season: string; user: string | null } | null {
  const season = labels.find((l) => l.startsWith(SEASON_KEY_PREFIX))?.slice(SEASON_KEY_PREFIX.length);
  if (!season) return null;
  const user = labels.find((l) => l.startsWith("User:"))?.slice(5) ?? null;
  return { season, user };
}

/** `season|user`, the key a run's wanted rows and the existing rows are compared by. */
export function rowId(season: string, user: string | null): string {
  return `${season}|${user ?? ""}`;
}

/** The title a person's own row reads as. */
export function personalSeasonName(name: string): string {
  return `${name} picks for you`;
}

const answerSchema = z.object({ items: z.array(z.string()) });

export const SEASON_ANSWER_JSON_SCHEMA = {
  type: "object",
  properties: { items: { type: "array", items: { type: "string" } } },
  required: ["items"],
};

export function seasonPrompt(season: { name: string; keywords: Array<{ name: string }> }, count: number): string {
  return `Pick up to ${count} titles from the library above that are ${season.name} viewing: set at ${season.name}, about it, or a tradition at that time of year. Themes that count: ${season.keywords
    .map((k) => k.name)
    .join(", ")}.

Only titles from the library, named exactly as listed. Leave out anything you are unsure of — fewer right answers beat padding.

Reply with JSON only: {"items": ["Title (Year)", ...]}`;
}

/** The model's titles, or null for an answer that isn't the JSON asked for. */
export function parseSeasonAnswer(text: string): string[] | null {
  const parsed = answerSchema.safeParse(extractJSON(text));
  return parsed.success ? parsed.data.items : null;
}
