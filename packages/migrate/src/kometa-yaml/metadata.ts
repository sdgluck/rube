import { asRecord, asStringList, parseYamlFile } from "./parse.ts";
import type { ImportFile } from "./types.ts";
import type { PlanDiagnostic } from "../types.ts";

/**
 * Kometa metadata files → per-item overrides.
 *
 * These are the edits somebody made by hand: a corrected title, a sort title
 * that files a series properly, a summary they wrote themselves. They're the
 * least reproducible part of a Kometa config — a collection can be rebuilt from
 * a rule, but nobody is going to retype four hundred summaries — which is
 * exactly why leaving them behind was the worst of the gaps.
 *
 * Kometa's format keys entries by title, optionally with a year, and lets an
 * entry carry explicit ids instead. All three are preserved here and resolved
 * against the library later; guessing at match time would be guessing with the
 * user's metadata.
 */

/** A field we can write to a Plex item. Mirrors Plex's own scalar set. */
export const OVERRIDE_FIELDS = [
  "title",
  "titleSort",
  "summary",
  "tagline",
  "contentRating",
  "studio",
  "originallyAvailableAt",
  "year",
] as const;
export type OverrideField = (typeof OVERRIDE_FIELDS)[number];

/** Tag sets Plex accepts. Wider than the rule engine's genre/label pair. */
export const OVERRIDE_TAG_FIELDS = ["genre", "collection", "label", "director", "writer"] as const;
export type OverrideTagField = (typeof OVERRIDE_TAG_FIELDS)[number];

/** Kometa's key → ours. Kometa uses snake_case and a few different names. */
const FIELD_ALIASES: Record<string, OverrideField> = {
  title: "title",
  sort_title: "titleSort",
  titlesort: "titleSort",
  summary: "summary",
  tagline: "tagline",
  content_rating: "contentRating",
  contentrating: "contentRating",
  studio: "studio",
  originally_available: "originallyAvailableAt",
  originally_available_at: "originallyAvailableAt",
  release_date: "originallyAvailableAt",
  year: "year",
};

const TAG_ALIASES: Record<string, OverrideTagField> = {
  genre: "genre",
  genres: "genre",
  collection: "collection",
  collections: "collection",
  label: "label",
  labels: "label",
  director: "director",
  directors: "director",
  writer: "writer",
  writers: "writer",
};

/**
 * How to find the item this override belongs to.
 *
 * Kometa's own key is a title, which is ambiguous on purpose — it's what a
 * person types. An entry may also carry `imdb_id`/`tmdb_id`, which isn't
 * ambiguous at all, so both travel and the resolver prefers the id.
 */
export interface OverrideMatch {
  title: string;
  year?: number;
  imdb?: string;
  tmdb?: number;
}

export interface MetadataOverride {
  match: OverrideMatch;
  /** Scalar fields to set. */
  fields: Partial<Record<OverrideField, string>>;
  /** Tag sets to replace wholesale — Kometa's semantics for these keys. */
  tags: Partial<Record<OverrideTagField, string[]>>;
  /** Which Kometa library this override was reached through. */
  libraryName: string;
  file: string;
  line?: number;
}

export interface MetadataFileResult {
  overrides: MetadataOverride[];
  diagnostics: PlanDiagnostic[];
}

/** `Star Wars (1977)` → `{ title: "Star Wars", year: 1977 }`. */
export function parseTitleKey(key: string): { title: string; year?: number } {
  const m = key.trim().match(/^(.*?)\s*\((\d{4})\)\s*$/);
  if (m) return { title: m[1]!.trim(), year: Number(m[2]) };
  return { title: key.trim() };
}

function toNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Read one Kometa metadata file.
 *
 * Season- and episode-level blocks are recognised and reported rather than
 * silently dropped: they're a real part of what some configs do, and a user
 * whose episode titles didn't come across should be told so on the screen that
 * lists what didn't, not left to notice it later.
 */
export function readMetadataFile(file: ImportFile, libraryName: string): MetadataFileResult {
  const parsed = parseYamlFile(file.path, file.text);
  const diagnostics = [...parsed.diagnostics];
  const overrides: MetadataOverride[] = [];

  const root = asRecord(parsed.value);
  if (!root) return { overrides, diagnostics };

  // Kometa spells the block `metadata:`; some configs use `movies:`/`shows:`.
  const blockKey = ["metadata", "movies", "shows"].find((k) => asRecord(root[k]) != null);
  if (!blockKey) {
    diagnostics.push({
      severity: "info",
      file: file.path,
      message: "No `metadata:` block — nothing to migrate from this file.",
    });
    return { overrides, diagnostics };
  }

  const block = asRecord(root[blockKey])!;
  let nested = 0;

  for (const [key, rawEntry] of Object.entries(block)) {
    const entry = asRecord(rawEntry);
    if (!entry) continue;

    const { title, year } = parseTitleKey(key);
    const fields: MetadataOverride["fields"] = {};
    const tags: MetadataOverride["tags"] = {};

    for (const [rawField, value] of Object.entries(entry)) {
      const field = rawField.toLowerCase();

      if (field === "seasons" || field === "episodes") {
        nested++;
        continue;
      }

      const scalar = FIELD_ALIASES[field];
      if (scalar) {
        // Kometa writes `<<remove>>` to clear a field; an empty write here
        // would mean the same thing, but it's not what the user asked for on
        // any field they merely left blank, so only explicit text carries.
        const text = value == null ? "" : String(value).trim();
        if (text && text !== "<<remove>>") fields[scalar] = text;
        continue;
      }

      const tag = TAG_ALIASES[field];
      if (tag) {
        const values = asStringList(value);
        if (values.length > 0) tags[tag] = values;
        continue;
      }
    }

    const match: OverrideMatch = { title, year };
    const imdb = typeof entry.imdb_id === "string" ? entry.imdb_id.trim() : "";
    if (imdb) match.imdb = imdb;
    const tmdb = toNumber(entry.tmdb_id ?? entry.tmdb_show_id ?? entry.tmdb_movie_id);
    if (tmdb != null) match.tmdb = tmdb;

    if (Object.keys(fields).length === 0 && Object.keys(tags).length === 0) continue;

    overrides.push({
      match,
      fields,
      tags,
      libraryName,
      file: file.path,
      line: parsed.lineOf([blockKey, key]),
    });
  }

  if (nested > 0) {
    diagnostics.push({
      severity: "warn",
      file: file.path,
      message: `${nested} entr(ies) also set season or episode metadata, which isn't migrated — only the show's own fields came across.`,
    });
  }

  return { overrides, diagnostics };
}
