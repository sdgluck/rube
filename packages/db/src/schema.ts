import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// NOTE: FTS5 virtual tables (`*_fts`) and their triggers live in
// drizzle/0004_fts_search.sql and are NOT represented in this file.
// drizzle-kit generate will not produce them — hand-audit any generated
// migration that touches search-related tables before applying.

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

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  command: text("command").notNull(),
  schedule: text("schedule").notNull().default(""),
  enabled: integer("enabled").notNull().default(1),
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
});

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
    ruleId: text("rule_id").notNull(),
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
