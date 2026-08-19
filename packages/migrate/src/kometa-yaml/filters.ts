import type { SmartFilterGroup, SmartFilterNode } from "@tinkerbell/plex-smart-filter";
import { asStringList } from "./parse.ts";
import type { PlanWarning } from "../types.ts";

/**
 * Kometa `filters:` / `plex_search:` → a Tinkerbell smart-filter tree.
 *
 * Kometa's filter vocabulary is much wider than Plex's query language: it
 * happily filters on `tmdb_vote_count` or `has_dolby_vision` by fetching the
 * data itself and discarding items in Python. Tinkerbell's smart filter is a
 * Plex query, so anything Plex can't express has to be dropped.
 *
 * The important design decision is that a dropped filter is *loud*. Silently
 * ignoring `tmdb_vote_count.gte: 100` produces a collection that looks right
 * on the review screen and then fills with obscure films the first time it
 * runs. Every drop becomes a warning and pushes the definition's confidence
 * down to `partial`, because the rule really will select a different set of
 * items than Kometa did.
 */

/** Kometa filter field → Plex smart-filter field. */
const FIELD_MAP: Record<string, string> = {
  genre: "genre",
  collection: "collection",
  label: "label",
  actor: "actor",
  director: "director",
  writer: "writer",
  studio: "studio",
  country: "country",
  content_rating: "contentRating",
  contentRating: "contentRating",
  resolution: "resolution",
  network: "network",
  year: "year",
  decade: "decade",
  plays: "viewCount",
  user_rating: "userRating",
  critic_rating: "rating",
  audience_rating: "audienceRating",
  release: "originallyAvailableAt",
  originally_available: "originallyAvailableAt",
  added: "addedAt",
  last_played: "lastViewedAt",
  duration: "duration",
  title: "title",
  summary: "summary",
  hdr: "hdr",
  unmatched: "unmatched",
  duplicate: "duplicate",
};

/**
 * Filters Kometa evaluates itself, against data Plex doesn't hold. Named
 * explicitly so the warning can say *why* rather than "unknown field" — the
 * difference between a user understanding the limit and filing a bug.
 */
const NON_PLEX_FIELDS = new Set([
  "tmdb_vote_count",
  "tmdb_year",
  "tmdb_genre",
  "tmdb_title",
  "tmdb_keyword",
  "tmdb_status",
  "tmdb_type",
  "imdb_keyword",
  "original_language",
  "origin_country",
  "has_overlay",
  "has_dolby_vision",
  "has_edition",
  "versions",
  "audio_track_title",
  "filepath",
  "history",
]);

/** Kometa's comparison suffixes → Plex operators. */
const OP_SUFFIX: Record<string, "=" | "!=" | ">=" | "<=" | ">" | "<"> = {
  not: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  is: "=",
};

/** Suffixes Plex's query language has no operator for. */
const UNSUPPORTED_SUFFIX = new Set(["regex", "begins", "ends", "contains"]);

export interface FilterResult {
  filter: SmartFilterGroup | null;
  warnings: PlanWarning[];
}

function splitField(key: string): { field: string; suffix?: string } {
  const idx = key.lastIndexOf(".");
  if (idx === -1) return { field: key };
  const suffix = key.slice(idx + 1);
  if (suffix in OP_SUFFIX || UNSUPPORTED_SUFFIX.has(suffix)) {
    return { field: key.slice(0, idx), suffix };
  }
  return { field: key };
}

/**
 * Translate one `filters:` block.
 *
 * Kometa ANDs every key in the block, and ORs the values within a key
 * (`genre: [Action, Comedy]` means "Action or Comedy"). That maps onto an
 * `all` group of `any` sub-groups, which is exactly what the Plex query
 * language does with repeated keys.
 */
export function mapFilters(filters: Record<string, unknown>): FilterResult {
  const warnings: PlanWarning[] = [];
  const children: SmartFilterNode[] = [];

  for (const [rawKey, rawValue] of Object.entries(filters)) {
    const { field, suffix } = splitField(rawKey);

    if (NON_PLEX_FIELDS.has(field)) {
      warnings.push({
        code: "filter-not-in-plex",
        message: `Filter \`${rawKey}\` was dropped — it reads data Plex doesn't store, so Tinkerbell can't apply it in a Plex query. This collection will hold more items than Kometa's did.`,
      });
      continue;
    }

    if (suffix && UNSUPPORTED_SUFFIX.has(suffix)) {
      warnings.push({
        code: "filter-op-unsupported",
        message: `Filter \`${rawKey}\` was dropped — Plex smart filters have no \`${suffix}\` operator.`,
      });
      continue;
    }

    const plexField = FIELD_MAP[field];
    if (!plexField) {
      warnings.push({
        code: "filter-unknown-field",
        message: `Filter \`${rawKey}\` was dropped — Tinkerbell has no equivalent field.`,
      });
      continue;
    }

    const op = suffix ? OP_SUFFIX[suffix]! : "=";
    const values = asStringList(rawValue);
    if (values.length === 0) continue;

    if (values.length === 1) {
      children.push({ kind: "leaf", field: plexField, op, value: values[0]! });
    } else if (op === "!=") {
      // "not any of these" is an AND of negations, not an OR — the OR would
      // match everything, since nothing equals all of them at once.
      for (const value of values) {
        children.push({ kind: "leaf", field: plexField, op, value });
      }
    } else {
      children.push({
        kind: "group",
        combinator: "any",
        children: values.map((value) => ({ kind: "leaf" as const, field: plexField, op, value })),
      });
    }
  }

  if (children.length === 0) return { filter: null, warnings };
  return { filter: { kind: "group", combinator: "all", children }, warnings };
}

/**
 * `plex_search:` is the same vocabulary as `filters:`, wrapped in an optional
 * `any:` / `all:` block and with `sort_by`/`limit` mixed in alongside.
 */
export function mapPlexSearch(search: Record<string, unknown>): FilterResult & { limit?: number } {
  const warnings: PlanWarning[] = [];
  let limit: number | undefined;

  const body: Record<string, unknown> = {};
  let combinator: "all" | "any" = "all";

  for (const [key, value] of Object.entries(search)) {
    if (key === "limit") {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) limit = n;
      continue;
    }
    if (key === "sort_by") {
      warnings.push({
        code: "sort-by-dropped",
        message: `\`sort_by: ${String(value)}\` was dropped — Tinkerbell orders collections through the rule's presentation settings rather than the search.`,
      });
      continue;
    }
    if (key === "validate") continue;
    if ((key === "any" || key === "all") && value != null && typeof value === "object") {
      combinator = key;
      Object.assign(body, value as Record<string, unknown>);
      continue;
    }
    body[key] = value;
  }

  const mapped = mapFilters(body);
  warnings.push(...mapped.warnings);

  const filter =
    mapped.filter && combinator === "any" ? { ...mapped.filter, combinator: "any" as const } : mapped.filter;

  return { filter, warnings, limit };
}
