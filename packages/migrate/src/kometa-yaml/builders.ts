import { posterUrlRejection, type CollectionModeChoice, type CollectionSortChoice } from "@rube/contracts";
import { parseSmartFilterUri } from "@rube/plex-smart-filter";
import { mapFilters, mapPlexSearch } from "./filters.ts";
import { asRecord, asStringList } from "./parse.ts";
import { mapSchedule } from "./schedule.ts";
import type { KometaDefinition } from "./types.ts";
import type { PlanConfidence, PlanWarning } from "../types.ts";

/**
 * Kometa builder → Rube rule.
 *
 * This table is the migration. Everything else in the package exists to
 * deliver a `KometaDefinition` to it in good enough shape to be mapped.
 *
 * Two principles run through it:
 *
 *  - **A mapping that changes which items land is `partial`, not `close`.**
 *    `tmdb_company` becoming a `studios` rule is a real translation — we match
 *    on the studio's name rather than TMDb's company id, which will differ at
 *    the edges. Calling that faithful and letting somebody find out later is
 *    worse than saying so on the review screen.
 *  - **Unmappable is a result, not a failure.** A builder we don't support
 *    comes back as `null` with a reason, gets listed in the not-migrated
 *    report, and (once `static_list` lands) can be adopted as a frozen
 *    collection instead. Nothing about an unknown builder should stop the
 *    other hundred definitions migrating.
 */

export interface MappedDefinition {
  ruleType: string;
  ruleConfig: Record<string, unknown>;
  confidence: PlanConfidence;
  warnings: PlanWarning[];
  /** From `schedule: never` — create the rule, leave it switched off. */
  forceDisabled?: boolean;
}

export interface UnmappedDefinition {
  reason: string;
  builders: string[];
}

export interface MapOptions {
  /**
   * The config declared an `asset_directory`. Kometa applies assets to every
   * collection it builds when this is set, so it's a property of the config
   * rather than of any one definition — which is why it arrives as an option
   * rather than being read off `settings`.
   */
  hasAssetDirectory?: boolean;
}

/** Kometa chart id → Rube `imdb_chart` config value. */
const IMDB_CHART_MAP: Record<string, string> = {
  top_movies: "top_250_movies",
  top_250: "top_250_movies",
  top_shows: "top_250_tv",
  top_250_shows: "top_250_tv",
  popular_movies: "popular_movies",
  popular_shows: "popular_tv",
  box_office: "box_office",
  lowest_rated: "",
};

/**
 * Builders that need a Rube feature that doesn't exist yet, with the
 * reason stated in the user's terms rather than ours. These end up in the
 * not-migrated report, which doubles as the feature-request funnel — so the
 * wording is the message, not a placeholder.
 */
const KNOWN_UNSUPPORTED: Record<string, string> = {
  tmdb_discover: "TMDb Discover searches aren't supported yet.",
  tmdb_list: "TMDb lists aren't supported yet.",
  tmdb_keyword: "TMDb keyword searches aren't supported yet.",
  tmdb_trending_daily: "TMDb trending isn't supported yet.",
  tmdb_trending_weekly: "TMDb trending isn't supported yet.",
  tmdb_now_playing: "TMDb now-playing isn't supported yet.",
  tmdb_upcoming: "TMDb upcoming isn't supported yet.",
  tmdb_popular: "TMDb popular isn't supported yet — try Rube's own top-rated rule instead.",
  // Trakt public lists migrate; anything scoped to a Trakt *account* can't,
  // because Rube authenticates with a client id rather than a sign-in.
  trakt_watchlist: "Trakt watchlists need a Trakt sign-in, which isn't supported yet — only public lists migrate.",
  trakt_collection: "Trakt collections need a Trakt sign-in, which isn't supported yet — only public lists migrate.",
  trakt_recommendations:
    "Trakt recommendations need a Trakt sign-in, which isn't supported yet — only public lists migrate.",
  trakt_chart: "Trakt charts aren't supported yet — public Trakt lists are.",
  trakt_trending: "Trakt charts aren't supported yet — public Trakt lists are.",
  trakt_popular: "Trakt charts aren't supported yet — public Trakt lists are.",
  trakt_boxoffice: "Trakt charts aren't supported yet — public Trakt lists are.",
  letterboxd_list: "Letterboxd lists aren't supported yet.",
  icheckmovies_list: "ICheckMovies lists aren't supported yet.",
  stevenlu_popular: "StevenLu's popular list isn't supported yet.",
  reciperr_list: "Reciperr lists aren't supported yet.",
  flixpatrol_top: "FlixPatrol charts aren't supported yet.",
  boxofficemojo_top: "Box Office Mojo charts aren't supported yet.",
  tautulli_popular:
    "Tautulli builders aren't supported — Rube tracks playback itself, so a most-played rule can replace this.",
  tautulli_watched:
    "Tautulli builders aren't supported — Rube tracks playback itself, so a most-played rule can replace this.",
  mal_all: "MyAnimeList builders aren't supported.",
  anilist_top_rated: "AniList builders aren't supported.",
  anidb_popular: "AniDB builders aren't supported.",
  radarr_all: "Reading everything from Radarr isn't supported.",
  sonarr_all: "Reading everything from Sonarr isn't supported.",
  plex_collectionless: "Kometa's 'collectionless' builder has no Rube equivalent.",
  plex_watchlist: "Watchlist builders aren't supported yet.",
  plex_pilots: "The pilot-episodes builder has no Rube equivalent.",
};

/** Kometa `collection_mode` → Rube's named mode. */
const COLLECTION_MODE_MAP: Record<string, CollectionModeChoice | undefined> = {
  default: "default",
  hide: "hide",
  hide_items: "hide_items",
  show_items: "show_items",
};

/**
 * Kometa `collection_order` → Plex's own sort.
 *
 * Only three of Kometa's orderings survive, because only three are things
 * *Plex* can do. The rest (`random`, `imdb_rating`, `tmdb_popularity`, …)
 * Kometa achieves by hand-ordering members as it builds, which a Plex sort
 * pref can't express — those become a warning rather than a silent `release`.
 */
const COLLECTION_SORT_MAP: Record<string, CollectionSortChoice | undefined> = {
  release: "release",
  alpha: "alpha",
  custom: "custom",
};

/** Definition settings that carry no meaning for Rube. Dropped quietly. */
const IGNORED_SETTINGS = new Set([
  "save_report",
  "show_missing",
  "show_filtered",
  "show_unfiltered",
  "show_options",
  "run_again",
  "validate_builders",
  "cache_builders",
  "changes_webhooks",
  "missing_only_released",
  "only_filter_missing",
  "delete_below_minimum",
  "delete_not_scheduled",
  "sync_to_trakt_list",
  "sync_missing_to_trakt_list",
  "name",
  "schedule",
  "filters",
  "template",
  "variables",
]);

function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** IMDb list urls carry the id we actually need (`ls012345678`). */
function imdbListId(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  const m = raw.match(/(ls\d+)/i);
  if (m) return m[1]!;
  return /^ls\d+$/i.test(raw) ? raw : null;
}

/** MDBList urls are `https://mdblist.com/lists/<user>/<slug>`. */
function mdbListId(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Map one definition. Returns `null` when no builder on it is supported —
 * the caller turns that into an unmappable entry.
 */
export function mapDefinition(def: KometaDefinition, opts: MapOptions = {}): MappedDefinition | UnmappedDefinition {
  const warnings: PlanWarning[] = [];
  const builderKeys = Object.keys(def.builders);

  // Template expansion notes ride along on every definition built from a
  // template we only partly modelled.
  for (const note of def.templateWarnings) {
    warnings.push({ code: "template-partial", message: note });
  }

  if (builderKeys.length === 0) {
    return { reason: "No builder — nothing tells Rube what to put in this collection.", builders: [] };
  }
  if (builderKeys.length > 1) {
    warnings.push({
      code: "multiple-builders",
      message: `Kometa combined ${builderKeys.length} builders here (${builderKeys.join(", ")}); Rube rules have one source, so only the first was used.`,
    });
  }

  const base = mapBuilder(def, warnings);
  if (!base) {
    const reason = builderKeys.map((k) => KNOWN_UNSUPPORTED[k]).find(Boolean);
    return {
      reason: reason ?? `Rube has no equivalent for the \`${builderKeys[0]}\` builder.`,
      builders: builderKeys,
    };
  }

  const { settings } = def;
  const config: Record<string, unknown> = { ...base.ruleConfig, pinToHomepage: false };
  let confidence: PlanConfidence = base.confidence;

  // ─── Settings that carry across regardless of builder ──────────────────

  const limit = num(settings.limit);
  if (limit != null && config.limit == null) config.limit = limit;

  const minItems = num(settings.minimum_items);
  if (minItems != null) config.minItems = minItems;

  const presentation: Record<string, unknown> = {};
  if (typeof settings.summary === "string" && settings.summary.trim()) {
    presentation.summary = "custom";
    presentation.customSummary = settings.summary.trim().slice(0, 1000);
  }
  if (typeof settings.url_poster === "string" && settings.url_poster.trim()) {
    const url = settings.url_poster.trim();
    if (posterUrlRejection(url) == null) {
      presentation.poster = "url";
      presentation.posterUrl = url;
    } else {
      // The allow-list exists because Rube fetches these server-side on
      // a schedule and hands the bytes to an image decoder. Kometa's own
      // Default-Images and TMDb are on it; a personal file server is not.
      warnings.push({
        code: "poster-host-not-allowed",
        message: `The poster URL (${url}) isn't on Rube's allowed image hosts, so it wasn't carried across.`,
      });
    }
  }
  // A `file_poster`, or an `asset_directory` in the config, both mean "the
  // artwork is a file on disk". Rube reads the same directory, matching
  // on the collection's name the way Kometa does.
  if (settings.file_poster != null || opts.hasAssetDirectory) {
    if (presentation.poster == null) presentation.poster = "asset";
  }
  // ─── Plex presentation prefs ──────────────────────────────────────────

  const mode =
    COLLECTION_MODE_MAP[
      String(settings.collection_mode ?? "")
        .trim()
        .toLowerCase()
    ];
  if (settings.collection_mode != null) {
    if (mode) presentation.collectionMode = mode;
    else {
      warnings.push({
        code: "collection-mode-unknown",
        message: `Couldn't read Kometa's collection mode (\`${String(settings.collection_mode)}\`), so Plex's own default applies.`,
      });
      if (confidence === "exact") confidence = "close";
    }
  }

  const sort =
    COLLECTION_SORT_MAP[
      String(settings.collection_order ?? "")
        .trim()
        .toLowerCase()
    ];
  if (settings.collection_order != null) {
    if (sort) presentation.collectionSort = sort;
    else {
      // Kometa supports orderings Plex's own pref can't express (`random`,
      // `imdb_rating`, …) because it hand-orders the collection as it builds.
      warnings.push({
        code: "collection-order-unsupported",
        message: `Kometa ordered this collection by \`${String(settings.collection_order)}\`, which Plex's own sort can't express — it will use release order instead.`,
      });
      if (confidence === "exact") confidence = "close";
    }
  }

  if (typeof settings.sort_title === "string" && settings.sort_title.trim()) {
    presentation.sortTitle = settings.sort_title.trim().slice(0, 255);
  }

  if (Object.keys(presentation).length > 0) config.presentation = presentation;

  const sched = mapSchedule(settings.schedule);
  warnings.push(...sched.warnings);
  if (sched.schedule) config.schedule = sched.schedule;

  if (settings.sync_mode === "append") {
    warnings.push({
      code: "sync-mode-append",
      message:
        "Kometa appended to this collection without removing anything; Rube rebuilds membership each run, so items that no longer match will be removed.",
    });
    confidence = "partial";
  }

  for (const key of ["item_label", "item_genre", "item_edition", "item_refresh"]) {
    if (settings[key] != null) {
      warnings.push({
        code: "item-attribute-unsupported",
        message: `\`${key}\` wasn't carried across — Rube edits item metadata through a separate rule action.`,
      });
    }
  }

  if (settings.builder_level != null) {
    warnings.push({
      code: "builder-level-unsupported",
      message: `This collection held ${String(settings.builder_level)}s rather than whole titles, which Rube doesn't support.`,
    });
    confidence = "partial";
  }

  // Anything left that we neither used nor deliberately ignored. Reporting the
  // long tail costs one line and saves the user guessing what was lost.
  const unused = Object.keys(settings).filter(
    (k) =>
      !IGNORED_SETTINGS.has(k) &&
      ![
        "limit",
        "minimum_items",
        "summary",
        "url_poster",
        "file_poster",
        "collection_order",
        "collection_mode",
        "sort_title",
        "sync_mode",
        "item_label",
        "item_genre",
        "item_edition",
        "item_refresh",
        "builder_level",
        "smart_label",
        "collection_name",
        "blank_collection",
        "build_collection",
        "test",
        "server_preroll",
      ].includes(k),
  );
  if (unused.length > 0) {
    warnings.push({
      code: "settings-dropped",
      message: `Kometa settings not carried across: ${unused.join(", ")}.`,
    });
  }

  return {
    ruleType: base.ruleType,
    ruleConfig: config,
    confidence: warnings.some((w) => w.code === "filter-not-in-plex" || w.code === "filter-op-unsupported")
      ? "partial"
      : confidence,
    warnings,
    forceDisabled: sched.disabled,
  };
}

/** The builder half of the mapping: which rule type, and its source config. */
function mapBuilder(
  def: KometaDefinition,
  warnings: PlanWarning[],
): { ruleType: string; ruleConfig: Record<string, unknown>; confidence: PlanConfidence } | null {
  const b = def.builders;
  const collectionName = def.collectionName;
  const filters = def.filters;

  // ─── Plex-native selection ─────────────────────────────────────────────

  if ("plex_search" in b || "plex_all" in b) {
    const search = asRecord(b.plex_search) ?? {};
    const mapped = mapPlexSearch(search);
    warnings.push(...mapped.warnings);

    const fromFilters = mapFilters(filters);
    warnings.push(...fromFilters.warnings);

    // A definition can carry both `plex_search` and a `filters:` block; Kometa
    // applies both, so they AND together.
    const children = [...(mapped.filter?.children ?? []), ...(fromFilters.filter?.children ?? [])];
    if (children.length === 0) {
      // `plex_all` with no filters is "every item in the library". That's a
      // legitimate Kometa pattern (usually paired with an overlay) but as a
      // collection it's a rule that sweeps the whole library into one place,
      // which is not something to create silently.
      return null;
    }

    const config: Record<string, unknown> = {
      smartFilter: { kind: "group", combinator: mapped.filter?.combinator ?? "all", children },
      collectionName,
    };
    if (mapped.limit != null) config.limit = mapped.limit;
    return { ruleType: "smart_filter", ruleConfig: config, confidence: "exact" };
  }

  if ("smart_filter" in b) {
    const raw = b.smart_filter;
    // Kometa accepts both its own dict form and a pasted Plex filter URI.
    if (typeof raw === "string" && raw.includes("?")) {
      const { filter, unsupported } = parseSmartFilterUri(raw);
      if (filter.children.length === 0) return null;
      if (unsupported.length > 0) {
        warnings.push({
          code: "filter-op-unsupported",
          message: `Parts of this smart filter couldn't be read: ${unsupported.join(", ")}.`,
        });
      }
      warnings.push(SMART_BECOMES_STATIC);
      return {
        ruleType: "smart_filter",
        ruleConfig: { smartFilter: filter, collectionName },
        confidence: "close",
      };
    }
    const search = asRecord(raw) ?? {};
    const mapped = mapPlexSearch(search);
    warnings.push(...mapped.warnings);
    if (!mapped.filter) return null;
    warnings.push(SMART_BECOMES_STATIC);
    const config: Record<string, unknown> = { smartFilter: mapped.filter, collectionName };
    if (mapped.limit != null) config.limit = mapped.limit;
    return { ruleType: "smart_filter", ruleConfig: config, confidence: "close" };
  }

  // ─── External lists ────────────────────────────────────────────────────

  if ("imdb_chart" in b) {
    const key = String(b.imdb_chart ?? "").trim();
    const chart = IMDB_CHART_MAP[key];
    if (!chart) {
      warnings.push({
        code: "imdb-chart-unknown",
        message: `Rube doesn't have IMDb's "${key}" chart.`,
      });
      return null;
    }
    return { ruleType: "imdb_chart", ruleConfig: { chart, collectionName }, confidence: "exact" };
  }

  if ("imdb_list" in b) {
    const listId = imdbListId(asStringList(b.imdb_list)[0] ?? b.imdb_list);
    if (!listId) {
      warnings.push({
        code: "imdb-list-unreadable",
        message: "Couldn't find an IMDb list id (ls…) in this builder.",
      });
      return null;
    }
    return { ruleType: "imdb_list", ruleConfig: { listId, collectionName }, confidence: "exact" };
  }

  if ("imdb_award" in b) {
    warnings.push({
      code: "award-generalised",
      message:
        "Rube's awards rule groups by award rather than reproducing one specific ceremony or year, so this collection's contents will differ.",
    });
    return { ruleType: "awards", ruleConfig: {}, confidence: "partial" };
  }

  if ("mdblist_list" in b) {
    const listId = mdbListId(asStringList(b.mdblist_list)[0] ?? b.mdblist_list);
    if (!listId) return null;
    return {
      ruleType: "list_source",
      ruleConfig: { listProvider: "mdblist", listId, collectionName },
      confidence: "exact",
    };
  }

  // Only the list builders map. The rest of the `trakt_*` family needs a Trakt
  // *sign-in* — a watchlist belongs to a person, not to a server — and
  // Rube authenticates with a client id alone. Mapping them anyway would
  // mint rules that fail on every run, which is a worse outcome than an
  // honest entry in the not-migrated report.
  if ("trakt_list" in b || "trakt_userlist" in b) {
    const raw = b.trakt_list ?? b.trakt_userlist;
    const value = asStringList(raw)[0] ?? String(raw ?? "");
    if (!value) return null;
    return {
      ruleType: "list_source",
      ruleConfig: { listProvider: "trakt", listId: value, collectionName },
      confidence: "exact",
    };
  }

  // ─── TMDb-backed grouping ──────────────────────────────────────────────

  if ("tmdb_company" in b) {
    warnings.push(TMDB_BY_NAME("studio"));
    return { ruleType: "studios", ruleConfig: {}, confidence: "partial" };
  }
  if ("tmdb_network" in b) {
    warnings.push(TMDB_BY_NAME("network"));
    return { ruleType: "networks", ruleConfig: {}, confidence: "partial" };
  }
  if ("tmdb_actor" in b || "tmdb_person" in b) {
    warnings.push(TMDB_BY_NAME("actor"));
    return { ruleType: "actors", ruleConfig: {}, confidence: "partial" };
  }
  if ("tmdb_collection" in b || "tmdb_collection_details" in b) {
    warnings.push({
      code: "franchise-generalised",
      message:
        "Rube builds franchise collections from TMDb across the whole library rather than from one named collection id, so this may produce a different set.",
    });
    return { ruleType: "tmdb_franchises", ruleConfig: {}, confidence: "partial" };
  }
  if ("tmdb_top_rated" in b) {
    warnings.push({
      code: "top-rated-is-local",
      message:
        "Rube's top-rated rule ranks what's in your library rather than TMDb's global chart, so the contents will differ.",
    });
    return { ruleType: "top_rated", ruleConfig: { collectionName }, confidence: "partial" };
  }

  return null;
}

const SMART_BECOMES_STATIC: PlanWarning = {
  code: "smart-becomes-static",
  message:
    "Rube rebuilds this collection on each run instead of leaving Plex a live smart filter, so membership updates on the rule's schedule rather than instantly.",
};

function TMDB_BY_NAME(kind: string): PlanWarning {
  return {
    code: "tmdb-id-to-name",
    message: `Kometa selected this by TMDb ${kind} id; Rube groups by ${kind} name, so titles TMDb attributes differently may not line up.`,
  };
}
