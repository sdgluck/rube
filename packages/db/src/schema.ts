import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// ─────────────────────────────────────────────────────────────────────────────
// FTS5 coupling
//
// The base tables below have a corresponding `<name>_fts` virtual table plus
// AFTER INSERT/DELETE/UPDATE triggers defined in
// `drizzle/0004_fts_search.sql`. Drizzle does not model FTS5 virtual tables,
// so they live ONLY in that hand-written migration:
//
//   collections      → collections_fts
//   media_items      → media_items_fts
//   rules            → rules_fts
//   jobs             → jobs_fts
//   overlay_presets  → overlay_presets_fts
//   events           → events_fts
//   plex_users       → plex_users_fts
//   plex_sections    → plex_sections_fts
//
// Rules for changes:
//
//  • If you add or rename a column on any of the above tables that is also
//    indexed by its FTS variant (title/summary/labels/section_title etc.),
//    write a NEW migration that drops + recreates the FTS table and triggers.
//    `drizzle-kit generate` will NOT do this for you.
//
//  • If you add a NEW table that needs full-text search, declare it here and
//    write a migration that mirrors the pattern in 0004 (CREATE VIRTUAL TABLE,
//    seed via INSERT … SELECT, then 3 triggers).
//
//  • Always hand-audit any auto-generated migration that touches the tables
//    listed above before applying — drizzle-kit may suggest column changes
//    that silently break the FTS triggers' column lists.
//
// The `FTS_TABLES` constant below is exported for any job/migration tooling
// that wants to rebuild indexes wholesale (e.g. after a schema migration).
// ─────────────────────────────────────────────────────────────────────────────

export const FTS_TABLES = [
  { base: "collections", fts: "collections_fts" },
  { base: "media_items", fts: "media_items_fts" },
  { base: "rules", fts: "rules_fts" },
  { base: "jobs", fts: "jobs_fts" },
  { base: "overlay_presets", fts: "overlay_presets_fts" },
  { base: "events", fts: "events_fts" },
  { base: "plex_users", fts: "plex_users_fts" },
  { base: "plex_sections", fts: "plex_sections_fts" },
] as const;

interface StressTestConfigShape {
  mode: "transcode" | "directplay" | "mixed";
  transcodePct?: number;
  maxSessions?: number;
}

interface StressTestStepShape {
  step: number;
  sessions: number;
  avgTranscodeSpeed: number | null;
  avgBandwidth: number;
  errors: number;
  timestamp: number;
}

export const config = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>(),
});

// Nullable: addedAt only — Plex sometimes omits it on items that have never
// been re-scanned. All other columns are notNull with sensible defaults so
// the upsert in syncCollections can stay value-uniform.
export const collections = sqliteTable(
  "collections",
  {
    plexRatingKey: text("plex_rating_key").primaryKey(),
    sectionId: text("section_id").notNull(),
    sectionTitle: text("section_title").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    childCount: integer("child_count").notNull().default(0),
    labels: text("labels", { mode: "json" }).$type<string[]>().notNull().default([]),
    addedAt: integer("added_at"),
    thumb: text("thumb").notNull().default(""),
    smart: integer("smart").notNull().default(0),
    /**
     * Plex smart-collection filter URI (e.g. `/library/sections/1/all?…`).
     * Empty string for non-smart collections; populated by collections sync
     * for `smart=1` rows so the Plex Smart Collections migration provider
     * can parse it offline.
     */
    smartFilter: text("smart_filter").notNull().default(""),
    syncedAt: integer("synced_at").notNull(),
  },
  (table) => [index("idx_collections_section").on(table.sectionId)],
);

export const collectionItems = sqliteTable(
  "collection_items",
  {
    collectionRatingKey: text("collection_rating_key").notNull(),
    itemRatingKey: text("item_rating_key").notNull(),
  },
  (table) => [
    uniqueIndex("idx_collection_items_pk").on(table.collectionRatingKey, table.itemRatingKey),
    index("idx_collection_items_item").on(table.itemRatingKey),
  ],
);

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  command: text("command").notNull(),
  schedule: text("schedule").notNull().default(""),
  enabled: integer("enabled").notNull().default(1),
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
});

// Nullable: every `last*` column. A rule has no run history until it runs
// for the first time, and `lastCollectionRatingKey` stays null until the
// rule has actually produced a collection (some rule types never do —
// preview-only, etc.). Callers should treat null as "hasn't happened yet".
export const rules = sqliteTable("rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  enabled: integer("enabled").notNull().default(1),
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  createdAt: integer("created_at").notNull(),
  lastCollectionRatingKey: text("last_collection_rating_key"),
  lastRunAt: integer("last_run_at"),
  lastRunDurationMs: integer("last_run_duration_ms"),
  lastRunCollectionCount: integer("last_run_collection_count"),
  lastRunItemCount: integer("last_run_item_count"),
  lastRunStatus: text("last_run_status"), // "ok" | "error" | "cancelled"
  lastRunError: text("last_run_error"),
  lastTestAt: integer("last_test_at"),
  lastTestDurationMs: integer("last_test_duration_ms"),
  lastTestCollectionCount: integer("last_test_collection_count"),
  lastTestItemCount: integer("last_test_item_count"),
  lastTestStatus: text("last_test_status"),
  lastTestError: text("last_test_error"),
  lastRunArrAddedCount: integer("last_run_arr_added_count"),
  lastRunArrSkippedCount: integer("last_run_arr_skipped_count"),
  lastRunArrFailedCount: integer("last_run_arr_failed_count"),
});

export const ruleHistory = sqliteTable(
  "rule_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ruleId: text("rule_id")
      .notNull()
      .references(() => rules.id, { onDelete: "cascade" }),
    sectionKey: text("section_key").notNull(),
    sectionTitle: text("section_title").notNull(),
    runAt: integer("run_at").notNull(),
    collections: text("collections", { mode: "json" })
      .$type<{ name: string; sampleItems: string[] }[]>()
      .notNull()
      .default([]),
  },
  (table) => [index("idx_rule_history_rule_section_run").on(table.ruleId, table.sectionKey, table.runAt)],
);

// Nullable: finishedAt only — null while the run is still in progress, set
// when the run terminates (success, failure, or cancellation).
export const jobRuns = sqliteTable(
  "job_runs",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    status: text("status").notNull().default("running"),
    log: text("log").notNull().default(""),
    progress: real("progress").notNull().default(0),
    message: text("message").notNull().default(""),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (table) => [index("idx_job_runs_job_status_started").on(table.jobId, table.status, table.startedAt)],
);

export const overlayConfigs = sqliteTable(
  "overlay_configs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sectionId: text("section_id").notNull(),
    position: text("position").notNull(),
    overlayType: text("overlay_type").notNull(),
    order: integer("order").notNull().default(0),
    style: text("style"), // JSON: BadgeStyle | null
    rule: text("rule"), // JSON: ConditionalRule | null
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_overlay_configs_section").on(table.sectionId),
    uniqueIndex("idx_overlay_configs_section_position_order").on(table.sectionId, table.position, table.order),
  ],
);

export const overlayPresets = sqliteTable("overlay_presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  builtIn: integer("built_in").notNull().default(0),
  data: text("data").notNull(), // JSON: PresetData
  createdAt: integer("created_at").notNull(),
});

export const overlayOriginals = sqliteTable(
  "overlay_originals",
  {
    ratingKey: text("rating_key").primaryKey(),
    sectionId: text("section_id").notNull(),
    originalPosterUrl: text("original_poster_url").notNull(),
    appliedAt: integer("applied_at").notNull(),
  },
  (table) => [index("idx_overlay_originals_section").on(table.sectionId)],
);

export const healthChecks = sqliteTable(
  "health_checks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    service: text("service").notNull(),
    status: text("status").notNull(), // "ok" | "error"
    message: text("message").notNull(),
    timestamp: integer("timestamp").notNull(),
  },
  (table) => [index("idx_health_checks_service_timestamp").on(table.service, table.timestamp)],
);

// Nullable: metadata. Some event types ride on just `message`; others
// (`job.completed`, `health.failed`) attach structured context like
// `{ jobId, service, durationMs }`.
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type").notNull(),
    message: text("message").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    timestamp: integer("timestamp").notNull(),
  },
  (table) => [index("idx_events_timestamp").on(table.timestamp)],
);

// Nullable: year, thumb, addedAt, all media-attribute columns. Plex omits
// these on items that haven't been scanned yet or that have no underlying
// media file (placeholder shows, deleted-but-still-referenced items, etc).
// syncedAt is always set by sync-media.
export const mediaItems = sqliteTable(
  "media_items",
  {
    ratingKey: text("rating_key").primaryKey(),
    sectionId: text("section_id").notNull(),
    sectionTitle: text("section_title").notNull(),
    title: text("title").notNull(),
    year: integer("year"),
    thumb: text("thumb"),
    type: text("type").notNull(),
    addedAt: integer("added_at"),
    videoResolution: text("video_resolution"),
    videoCodec: text("video_codec"),
    audioCodec: text("audio_codec"),
    audioChannels: integer("audio_channels"),
    container: text("container"),
    syncedAt: integer("synced_at").notNull(),
  },
  (table) => [
    index("idx_media_items_section_type").on(table.sectionId, table.type),
    index("idx_media_items_type").on(table.type),
    index("idx_media_items_title").on(table.title),
    index("idx_media_items_video_resolution").on(table.videoResolution),
    index("idx_media_items_video_codec").on(table.videoCodec),
    index("idx_media_items_audio_codec").on(table.audioCodec),
    index("idx_media_items_audio_channels").on(table.audioChannels),
    index("idx_media_items_container").on(table.container),
  ],
);

export const plexSections = sqliteTable("plex_sections", {
  key: text("key").primaryKey(),
  title: text("title").notNull(),
  type: text("type").notNull(),
  syncedAt: integer("synced_at").notNull(),
});

export const statsCache = sqliteTable("stats_cache", {
  key: text("key").primaryKey(),
  data: text("data", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// Nullable: name, lastWatched{Title,At}. Plex managed/home users may not have
// a display name distinct from `username`, and lastWatched* is null until
// the user has watched anything.
export const plexUsers = sqliteTable(
  "plex_users",
  {
    userId: integer("user_id").primaryKey(),
    username: text("username").notNull(),
    name: text("name"),
    label: text("label").notNull(),
    collectionCount: integer("collection_count").notNull().default(0),
    lastWatchedTitle: text("last_watched_title"),
    lastWatchedAt: integer("last_watched_at"),
    syncedAt: integer("synced_at").notNull(),
  },
  (table) => [index("idx_plex_users_username").on(table.username)],
);

// Snapshot of each shared user's plex.tv sharing filters captured when the
// personalization master switch is enabled, so disabling can restore the
// exact prior state instead of just clearing. One row per sharing.
export const sharingRestrictionBackups = sqliteTable("sharing_restriction_backups", {
  sharingId: integer("sharing_id").primaryKey(),
  userId: integer("user_id").notNull(),
  username: text("username").notNull(),
  filterMovies: text("filter_movies").notNull().default(""),
  filterTelevision: text("filter_television").notNull().default(""),
  capturedAt: integer("captured_at").notNull(),
});

// Per-user personalization preferences (loved/liked/hated genres etc.). The
// JSON blob is validated by `userPreferencesSchema` in @tinkerbell/core;
// keyed by Plex user id to match `plex_users.userId`.
export const userPreferences = sqliteTable("user_preferences", {
  userId: integer("user_id").primaryKey(),
  preferences: text("preferences", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  optedIn: integer("opted_in").notNull().default(1),
  updatedAt: integer("updated_at").notNull(),
});

// Portal login sessions for the Sign-in-with-Plex flow. `id` is the SHA-256 of
// the opaque cookie token (the raw token is only ever in the user's cookie).
export const plexSessions = sqliteTable(
  "plex_sessions",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id").notNull(),
    username: text("username").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("idx_plex_sessions_expires").on(table.expiresAt)],
);

export const stressTestRuns = sqliteTable("stress_test_runs", {
  id: text("id").primaryKey(),
  config: text("config", { mode: "json" }).$type<StressTestConfigShape>().notNull(),
  maxSessions: integer("max_sessions"),
  steps: text("steps", { mode: "json" }).$type<StressTestStepShape[]>().notNull().default([]),
  status: text("status").notNull().default("running"),
  progress: real("progress").notNull().default(0),
  message: text("message").notNull().default(""),
  log: text("log").notNull().default(""),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
});

export const omdbCache = sqliteTable("omdb_cache", {
  imdbId: text("imdb_id").primaryKey(),
  imdbRating: text("imdb_rating"),
  rtRating: text("rt_rating"),
  response: text("response", { mode: "json" }).$type<unknown>().notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});

export interface TmdbCachedDetails {
  // Normalized fields used by grouped rule handlers. All optional — TV
  // entries lack production_companies for many shows; movie entries lack
  // networks; etc.
  genres?: Array<{ id: number; name: string }>;
  productionCompanies?: Array<{ id: number; name: string }>;
  productionCountries?: Array<{ code: string; name: string }>;
  networks?: Array<{ id: number; name: string }>;
  cast?: Array<{ id: number; name: string; order?: number }>;
  directors?: Array<{ id: number; name: string }>;
  /** Map of ISO-3166-1 region code -> certification (e.g. "US" -> "PG-13"). */
  contentRatings?: Record<string, string>;
  /** TMDb keyword IDs (no names — those are looked up from a static map at use time). */
  keywords?: number[];
  /** Calendar month of release_date / first_air_date (1–12). Used by the seasonal rule. */
  releaseMonth?: number;
}

/**
 * Videos played before a movie starts, materialised on disk under
 * `PREROLLS_DIR` and referenced by Plex's `CinemaTrailersPrerollID` preference.
 *
 * `filename` is a UUID rather than the uploaded name because the Plex
 * preference is a `,`/`;`-delimited path list — a comma or semicolon in a
 * filename would silently corrupt it. The human-readable name lives in `name`.
 *
 * Nullable: `sourceUrl`, which is only set for URL imports. Every other column
 * defaults, so a row can be inserted the moment an upload starts and filled in
 * once the processing job has probed the file.
 */
export const prerolls = sqliteTable(
  "prerolls",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    originalFilename: text("original_filename").notNull(),
    /** Empty until processing succeeds; always `<id>.mp4` once ready. */
    filename: text("filename").notNull().default(""),
    /** pending | processing | ready | failed */
    status: text("status").notNull().default("pending"),
    enabled: integer("enabled").notNull().default(1),
    /** Playback order, only meaningful in sequential mode. */
    position: integer("position").notNull().default(0),
    sizeBytes: integer("size_bytes").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    width: integer("width").notNull().default(0),
    height: integer("height").notNull().default(0),
    fps: real("fps").notNull().default(0),
    videoCodec: text("video_codec").notNull().default(""),
    audioCodec: text("audio_codec").notNull().default(""),
    container: text("container").notNull().default(""),
    /** copy | remux | encode — what the processing job actually did. */
    transcodeAction: text("transcode_action").notNull().default(""),
    /** Why, shown verbatim in the detail modal. */
    transcodeReasons: text("transcode_reasons", { mode: "json" }).$type<string[]>().notNull().default([]),
    sourceUrl: text("source_url"),
    error: text("error").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_prerolls_status").on(table.status),
    index("idx_prerolls_enabled_position").on(table.enabled, table.position),
  ],
);

export const tmdbCache = sqliteTable(
  "tmdb_cache",
  {
    id: text("id").primaryKey(), // "movie:550" | "tv:1399"
    tmdbId: integer("tmdb_id").notNull(),
    mediaType: text("media_type").notNull(), // "movie" | "tv"
    data: text("data", { mode: "json" }).$type<TmdbCachedDetails>().notNull(),
    fetchedAt: integer("fetched_at").notNull(),
  },
  (table) => [index("idx_tmdb_cache_fetched_at").on(table.fetchedAt)],
);
