/**
 * The single source of truth for Plex smart-filter fields: what they're
 * called in plain English, and what shape their value takes.
 *
 * Both smart-filter editors (the collection drawer and the rule wizard's
 * `smart_filter` step) and the server-side registry resolver read from
 * here. Before this existed the same table was maintained in four places
 * and had already drifted — a field could be a tag on one screen and a
 * free-text string on another.
 *
 * `kind` drives three things in the UI: which operators are offered, which
 * input control renders, and how a stored value is formatted for display.
 * It never changes what is written to Plex — the wire value for every kind
 * is still the raw string Plex expects.
 */

export type SmartFilterFieldKind =
  /** Value is a per-server numeric tag key resolved via `/library/sections/:id/:field`. */
  | "tag"
  /** Plain integer — year, play count, episode count. */
  | "number"
  /** 0-10 score. */
  | "rating"
  /** ISO date (`2024-01-31`) or a Plex relative offset (`-30d`, `-2w`, `-3mon`, `-1y`). */
  | "date"
  /** Milliseconds. */
  | "duration"
  /** `"1"` or `"0"`. */
  | "boolean"
  /** Free text. */
  | "string";

export interface SmartFilterFieldDef {
  field: string;
  label: string;
  kind: SmartFilterFieldKind;
  /** Suffix shown after a numeric input, e.g. `kbps`. */
  unit?: string;
  /** Hidden from the field pickers, but still labelled and formatted if a
   *  stored filter references it. */
  advanced?: boolean;
  /**
   * `plex` — emitted into the Plex query string (every field that exists
   *   today, so it is also the default).
   * `local` — stripped from the query and evaluated against `watch_state`
   *   after Plex returns. Local fields carry multi-user semantics Plex's
   *   token-scoped view state cannot express.
   */
  source?: "plex" | "local";
  /** One-line explanation, shown beside the field in the picker. */
  hint?: string;
}

export const SMART_FILTER_FIELD_DEFS: readonly SmartFilterFieldDef[] = [
  // Tags — values are numeric keys, resolved to titles per section.
  { field: "genre", label: "Genre", kind: "tag" },
  { field: "collection", label: "Collection", kind: "tag" },
  { field: "label", label: "Label", kind: "tag" },
  { field: "actor", label: "Actor", kind: "tag" },
  { field: "director", label: "Director", kind: "tag" },
  { field: "writer", label: "Writer", kind: "tag" },
  { field: "studio", label: "Studio", kind: "tag" },
  { field: "country", label: "Country", kind: "tag" },
  { field: "contentRating", label: "Content rating", kind: "tag" },
  { field: "resolution", label: "Resolution", kind: "tag" },
  { field: "network", label: "Network", kind: "tag" },

  // Numbers.
  { field: "year", label: "Year", kind: "number" },
  { field: "decade", label: "Decade", kind: "number" },
  { field: "viewCount", label: "Plays", kind: "number" },
  { field: "unviewedLeafCount", label: "Unplayed episodes", kind: "number" },
  { field: "unwatchedLeaves", label: "Unplayed episodes", kind: "number" },
  { field: "mediaHeight", label: "Height", kind: "number", unit: "px" },
  { field: "mediaBitrate", label: "Bitrate", kind: "number", unit: "kbps" },

  // Ratings.
  { field: "rating", label: "Critic rating", kind: "rating" },
  { field: "audienceRating", label: "Audience rating", kind: "rating" },
  { field: "userRating", label: "Your rating", kind: "rating" },

  // Dates.
  { field: "originallyAvailableAt", label: "Release date", kind: "date" },
  { field: "addedAt", label: "Date added", kind: "date" },
  { field: "lastViewedAt", label: "Last played", kind: "date" },

  // Duration.
  { field: "duration", label: "Duration", kind: "duration" },

  // Booleans. Plex stores these as "1"/"0".
  { field: "unwatched", label: "Unplayed", kind: "boolean" },
  { field: "inProgress", label: "In progress", kind: "boolean" },
  { field: "trash", label: "Trashed", kind: "boolean" },
  { field: "duplicate", label: "Duplicate", kind: "boolean" },
  { field: "unmatched", label: "Unmatched", kind: "boolean" },
  { field: "hdr", label: "HDR", kind: "boolean" },

  // Strings.
  { field: "title", label: "Title", kind: "string" },
  // The sort-only twin of `title`; kept out of the field picker so "Title"
  // doesn't appear in it twice.
  { field: "titleSort", label: "Title", kind: "string", advanced: true },
  { field: "summary", label: "Summary", kind: "string" },

  // ─── Local — evaluated against Tinkerbell's own `watch_state` ─────────────
  //
  // Plex answers view state for whichever token asked, and Tinkerbell asks with
  // the server owner's. `unwatched=1` above therefore means "the owner hasn't
  // watched it", which on a family server is almost never the question anyone
  // wants answered. These fields ask it properly, across every user, and are
  // stripped from the Plex query and applied afterwards — see `splitLocalLeaves`.
  {
    field: "tb.watchedByAll",
    label: "Watched by everyone",
    kind: "boolean",
    source: "local",
    hint: "Every user in scope has a completed play.",
  },
  {
    field: "tb.watchedByNobody",
    label: "Watched by nobody",
    kind: "boolean",
    source: "local",
    hint: "No user has a completed play.",
  },
  {
    field: "tb.watchedBy",
    label: "Watched by",
    kind: "tag",
    source: "local",
    hint: "A specific user has a completed play.",
  },
  {
    field: "tb.playCount",
    label: "Plays (all users)",
    kind: "number",
    source: "local",
    hint: "Completed plays summed across every user.",
  },
  {
    field: "tb.lastPlayedAt",
    label: "Last played (any user)",
    kind: "date",
    source: "local",
    hint: "The most recent play by anyone.",
  },
  {
    field: "tb.abandonedPct",
    label: "Abandoned below",
    kind: "number",
    unit: "%",
    source: "local",
    hint: "Highest completion any user reached. Only matches items someone actually started.",
  },
];

const BY_FIELD = new Map(SMART_FILTER_FIELD_DEFS.map((d) => [d.field, d]));

/** Field defs evaluated locally rather than emitted to Plex. */
export const LOCAL_FIELD_DEFS: readonly SmartFilterFieldDef[] = SMART_FILTER_FIELD_DEFS.filter(
  (d) => d.source === "local",
);

/**
 * On a TV section Plex qualifies a field with the level it applies to —
 * `show.genre`, `episode.unwatched`, `season.addedAt`. The suffix is an
 * ordinary field, so rather than enumerating the cross-product we peel the
 * scope off and look the base field up.
 */
const SCOPE_LABELS: Record<string, string> = {
  show: "Show",
  season: "Season",
  episode: "Episode",
  artist: "Artist",
  album: "Album",
  track: "Track",
};

function splitScope(field: string): { scope: string | null; base: string } {
  const dot = field.indexOf(".");
  if (dot === -1) return { scope: null, base: field };
  const scope = field.slice(0, dot);
  return scope in SCOPE_LABELS ? { scope, base: field.slice(dot + 1) } : { scope: null, base: field };
}

export function fieldDef(field: string): SmartFilterFieldDef | undefined {
  return BY_FIELD.get(field) ?? BY_FIELD.get(splitScope(field).base);
}

export function fieldKind(field: string): SmartFilterFieldKind {
  return fieldDef(field)?.kind ?? "string";
}

/** `audioLanguage` → `Audio language`, matching the curated labels' casing. */
function humanize(field: string): string {
  const spaced = field
    .replace(/([A-Z])/g, " $1")
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Human label for a field. Unknown fields — Plex has far more than we
 * enumerate — fall back to splitting camelCase, so `audioLanguage` reads
 * "Audio language" rather than leaking the raw key.
 */
export function fieldLabel(field: string): string {
  const direct = BY_FIELD.get(field);
  if (direct) return direct.label;

  const { scope, base } = splitScope(field);
  const baseLabel = BY_FIELD.get(base)?.label ?? humanize(base);
  // "Show genre", not "Show Genre" — labels are sentence-cased throughout.
  return scope ? `${SCOPE_LABELS[scope]} ${baseLabel.charAt(0).toLowerCase()}${baseLabel.slice(1)}` : baseLabel;
}
