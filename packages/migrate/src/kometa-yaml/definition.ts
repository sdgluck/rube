import { asRecord, parseYamlFile } from "./parse.ts";
import { expandDefinition } from "./templates.ts";
import type { ImportFile, KometaDefinition } from "./types.ts";
import type { PlanDiagnostic } from "../types.ts";

/**
 * A collection file → the definitions inside it, templates expanded.
 *
 * The only genuinely fiddly part is telling a *builder* from a *setting*.
 * Kometa's definition format is flat — `imdb_list`, `limit` and `sort_title`
 * all sit at the same level — and there's no marker distinguishing "this
 * chooses items" from "this configures the result". The mapping table needs
 * that split, so it's made here against a known-builder list.
 *
 * A key that's on neither list is treated as a setting, not a builder. That
 * way an unfamiliar knob is reported as a dropped setting (harmless, honest)
 * rather than mistaken for a builder we can't support (which would send an
 * otherwise-migratable definition to the unmappable pile).
 */

/**
 * Every Kometa builder key. Membership is what matters, not the value — the
 * mapping table decides what each one becomes, and anything here that isn't
 * in the table becomes a reported "no equivalent".
 */
export const BUILDER_KEYS = new Set([
  // Plex-native
  "plex_all",
  "plex_search",
  "plex_collectionless",
  "plex_watchlist",
  "plex_pilots",
  "smart_filter",
  "smart_label",
  // IMDb
  "imdb_chart",
  "imdb_list",
  "imdb_award",
  "imdb_search",
  "imdb_id",
  // TMDb
  "tmdb_collection",
  "tmdb_collection_details",
  "tmdb_company",
  "tmdb_network",
  "tmdb_actor",
  "tmdb_person",
  "tmdb_director",
  "tmdb_writer",
  "tmdb_producer",
  "tmdb_list",
  "tmdb_list_details",
  "tmdb_movie",
  "tmdb_show",
  "tmdb_discover",
  "tmdb_keyword",
  "tmdb_popular",
  "tmdb_top_rated",
  "tmdb_now_playing",
  "tmdb_upcoming",
  "tmdb_trending_daily",
  "tmdb_trending_weekly",
  // Trakt
  "trakt_list",
  "trakt_list_details",
  "trakt_userlist",
  "trakt_chart",
  "trakt_recommendations",
  "trakt_watchlist",
  "trakt_collection",
  "trakt_boxoffice",
  "trakt_popular",
  "trakt_trending",
  // Other list sources
  "mdblist_list",
  "letterboxd_list",
  "icheckmovies_list",
  "stevenlu_popular",
  "reciperr_list",
  "flixpatrol_top",
  "boxofficemojo_top",
  "tautulli_popular",
  "tautulli_watched",
  // Anime
  "mal_all",
  "mal_airing",
  "mal_popular",
  "mal_userlist",
  "anilist_top_rated",
  "anilist_popular",
  "anilist_search",
  "anidb_popular",
  "anidb_id",
  // *Arr
  "radarr_all",
  "radarr_taglist",
  "sonarr_all",
  "sonarr_taglist",
]);

/** Definition keys that configure expansion, not the collection. */
const META_KEYS = new Set(["template", "variables"]);

export interface ReadDefinitionsOptions {
  file: ImportFile;
  libraryName: string;
  libraryVars: Record<string, unknown>;
  refVars: Record<string, unknown>;
  /**
   * Read the `playlists:` block instead of `collections:`.
   *
   * The two are the same format — same builders, same filters, same settings —
   * differing only in what Kometa does with the result, so they share every
   * line of this reader.
   */
  block?: "collections" | "playlists";
}

export interface ReadDefinitionsResult {
  definitions: KometaDefinition[];
  diagnostics: PlanDiagnostic[];
}

export function readDefinitions(opts: ReadDefinitionsOptions): ReadDefinitionsResult {
  const { file, libraryName, libraryVars, refVars } = opts;
  const parsed = parseYamlFile(file.path, file.text);
  const diagnostics = [...parsed.diagnostics];
  const definitions: KometaDefinition[] = [];

  const root = asRecord(parsed.value);
  if (!root) return { definitions, diagnostics };

  const templates = asRecord(root.templates) ?? {};

  // Kometa spells the definitions block `collections:`, and `metadata:` in
  // older configs. Both are read; playlists are handled elsewhere.
  const blockKey =
    opts.block === "playlists"
      ? root.playlists != null
        ? "playlists"
        : null
      : root.collections != null
        ? "collections"
        : root.metadata != null
          ? "metadata"
          : null;
  if (!blockKey) {
    diagnostics.push({
      severity: "info",
      file: file.path,
      message: `No \`${opts.block ?? "collections"}:\` block — nothing to migrate from this file.`,
    });
    return { definitions, diagnostics };
  }

  const block = asRecord(root[blockKey]);
  if (!block) {
    diagnostics.push({
      severity: "warn",
      file: file.path,
      message: `\`${blockKey}:\` isn't a mapping — skipped.`,
    });
    return { definitions, diagnostics };
  }

  for (const [mappingName, rawDef] of Object.entries(block)) {
    const raw = asRecord(rawDef);
    if (!raw) {
      diagnostics.push({
        severity: "warn",
        file: file.path,
        line: parsed.lineOf([blockKey, mappingName]),
        message: `"${mappingName}" isn't a mapping — skipped.`,
      });
      continue;
    }

    const { definition: expanded, warnings } = expandDefinition({
      mappingName,
      definition: raw,
      templates,
      libraryVars,
      refVars,
      libraryName,
    });

    const builders: Record<string, unknown> = {};
    const settings: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(expanded)) {
      if (META_KEYS.has(key)) continue;
      if (BUILDER_KEYS.has(key)) builders[key] = value;
      else settings[key] = value;
    }

    // `filters:` is neither — it narrows whatever the builders produced.
    const filters = asRecord(expanded.filters) ?? {};
    delete settings.filters;

    // `test: true` and `build_collection: false` are how a user parks a
    // definition mid-edit. Migrating them would resurrect work-in-progress as
    // live rules.
    if (expanded.test === true || expanded.build_collection === false || expanded.blank_collection === true) {
      diagnostics.push({
        severity: "info",
        file: file.path,
        line: parsed.lineOf([blockKey, mappingName]),
        message: `"${mappingName}" was switched off in Kometa (test/blank/build_collection) — not migrated.`,
      });
      continue;
    }

    definitions.push({
      mappingName,
      collectionName: typeof expanded.name === "string" && expanded.name.trim() ? expanded.name.trim() : mappingName,
      builders,
      filters,
      settings,
      libraryName,
      file: file.path,
      line: parsed.lineOf([blockKey, mappingName]),
      templateWarnings: warnings,
    });
  }

  return { definitions, diagnostics };
}
