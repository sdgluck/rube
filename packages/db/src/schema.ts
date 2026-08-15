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
  /**
   * Pin-rotation bookkeeping: the collection names this rule pinned on its
   * last run, keyed by section. Keyed by NAME rather than rating key on
   * purpose — every run deletes and recreates the rule's collections, so
   * rating keys don't survive between runs but names do.
   */
  lastPinnedCollections: text("last_pinned_collections", { mode: "json" })
    .$type<Record<string, string[]>>()
    .notNull()
    .default({}),
  /**
   * Provenance for rules imported from the public registry (tinkerbell.dev).
   * All null for hand-made rules.
   *
   * `registryConfigHash` is the hash of the config *as imported*, after tag
   * resolution and section injection. Comparing it against a hash of the
   * live config is how the update check tells "untouched, safe to update"
   * from "the user has edited this" — the latter is reported but never
   * overwritten.
   */
  registryRuleSlug: text("registry_rule_slug"),
  registryPackSlug: text("registry_pack_slug"),
  registryVersion: integer("registry_version"),
  registryConfigHash: text("registry_config_hash"),
});

/**
 * Cross-context mutex for "this rule is generating collections right now".
 *
 * A rule run is delete-then-recreate: it removes every collection labelled
 * `Rule:<id>` and then creates fresh ones. Two overlapping runs of the same
 * rule therefore both delete before either creates, and both creations
 * survive as duplicate same-title collections in Plex. The runs that overlap
 * live in different execution contexts — the `generate` command runs in a
 * Sidequest worker thread, ad-hoc single-rule runs execute in the API process
 * — so an in-process Map cannot see both. SQLite can.
 *
 * The lock is a *lease*: `expiresAt` is pushed forward periodically while the
 * holder is alive, and a lock whose lease has run out is free for the taking.
 * That is deliberate — a worker thread killed with its process has no chance
 * to release, and a permanent lock would wedge the rule forever.
 *
 * No FK to `rules`: a lock belonging to a rule deleted mid-run is harmless
 * and expires on its own.
 */
export const ruleLocks = sqliteTable("rule_locks", {
  ruleId: text("rule_id").primaryKey(),
  /** Opaque owner token — only the holder that wrote it may renew or release. */
  holder: text("holder").notNull(),
  /** Human-readable owner ("generate job", "single-rule run"), for error messages. */
  holderLabel: text("holder_label").notNull().default(""),
  acquiredAt: integer("acquired_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
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

/**
 * Resumable per-job state, written by long commands as they make progress.
 *
 * Keyed on `jobId` rather than a run id on purpose: the point is for the *next*
 * run to pick up what the previous one abandoned when the container restarted.
 * Rows are cleared on successful completion and ignored past their TTL, so a
 * stale checkpoint can never silently skip work.
 */
export const jobCheckpoints = sqliteTable("job_checkpoints", {
  jobId: text("job_id")
    .primaryKey()
    .references(() => jobs.id, { onDelete: "cascade" }),
  data: text("data", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

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
    /**
     * Plex's `addedAt`, in **seconds** — Plex's unit, kept as-is so a value
     * read back matches what the server reports. Every other timestamp in this
     * schema is milliseconds, so anything comparing this against `Date.now()`
     * has to convert, and forgetting to is a silent off-by-1000x.
     */
    addedAt: integer("added_at"),
    /**
     * Taste columns. Plex returns all four in the section listing that
     * `syncMedia` already walks, so storing them costs no extra request — and
     * without them a per-user digest can only filter on title and year, which
     * is not "5 new things you'd like".
     *
     * Nullable throughout: an unmatched item has no genres, no rating and no
     * certificate, and a digest must treat "unknown" as "don't exclude it"
     * rather than "fails the filter".
     */
    genres: text("genres", { mode: "json" }).$type<string[]>(),
    /** Critic rating where Plex has one, else audience rating. 0–10. */
    rating: real("rating"),
    contentRating: text("content_rating"),
    durationMs: integer("duration_ms"),
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
    /**
     * The server owner. Recorded at sync time because the alternative — asking
     * plex.tv on every rule evaluation — puts a network round trip inside the
     * generate loop for a fact that changes approximately never. Rules that
     * define "everyone" need it: the owner's consumption pattern is usually
     * nothing like a shared user's, so they are excluded by default.
     */
    isOwner: integer("is_owner").notNull().default(0),
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

// Login sessions for the Sign-in-with-Plex flow. `id` is the SHA-256 of
// the opaque cookie token (the raw token is only ever in the user's cookie).
//
// `scope` separates the two apps that share this table: a "portal" session
// (any shared user, 30 days) must never authorise an admin call, and an
// "admin" session (the server owner, 7 days sliding) is issued by a different
// handshake. Every read passes the scope it requires — see `getPlexSession`.
export const plexSessions = sqliteTable(
  "plex_sessions",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id").notNull(),
    username: text("username").notNull(),
    scope: text("scope").notNull().default("portal"),
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

// One row per bandwidth test. Nullable: every measurement — a run that fails
// or is cancelled part-way still records the legs it did complete, which is
// what makes "download fine, upload timed out" readable after the fact.
export const bandwidthTests = sqliteTable(
  "bandwidth_tests",
  {
    id: text("id").primaryKey(),
    /** Megabits/sec. */
    downMbps: real("down_mbps"),
    upMbps: real("up_mbps"),
    /** Median TTFB and its mean absolute deviation, in ms. */
    latencyMs: real("latency_ms"),
    jitterMs: real("jitter_ms"),
    /** What was measured against, and the edge PoP that answered. */
    endpoint: text("endpoint").notNull(),
    pop: text("pop"),
    // How many connections ran at once. A parallel-stream figure and a
    // single-stream one differ by more than 2x on a multi-gig link — the same
    // server measured 736 Mbps on one connection and 1613 Mbps on four — so a
    // result without its parallelism can't be compared against anything.
    // Nullable: rows written before this column was added didn't record it.
    streams: integer("streams"),
    bytesDown: integer("bytes_down").notNull().default(0),
    bytesUp: integer("bytes_up").notNull().default(0),
    /** "ok" | "error" | "cancelled" */
    status: text("status").notNull(),
    error: text("error"),
    // Live session bandwidth (kbps) when the test started. A test run while
    // three people are streaming under-reports, and without this the row is
    // unexplainable a week later.
    concurrentKbps: integer("concurrent_kbps").notNull().default(0),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (table) => [index("idx_bandwidth_tests_started").on(table.startedAt)],
);

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

/**
 * One row per observed play. Written by the playback poller, which samples
 * `/status/sessions` every 30 seconds and diffs the result against the rows it
 * left open on the previous tick.
 *
 * This is the table Plex does not give us. `/status/sessions/history/all` is a
 * real historical log and we backfill from it (see `source` below), but it
 * carries only "account X viewed rating key Y at time T" — no completion
 * percentage, no watched duration, no player or transcode decision. Those come
 * only from sampling the live session, which is why the poller exists at all.
 *
 * Nullable: `endedAt` (null while the session is still open — the poller's hot
 * path is exactly this predicate) and `grandparentRatingKey` (null for movies).
 */
export const playbackSessions = sqliteTable(
  "playback_sessions",
  {
    /**
     * Ours, not Plex's. Plex reuses `sessionKey` values freely across plays, so
     * keying on it would silently merge two unrelated sessions into one row.
     */
    id: text("id").primaryKey(),
    plexSessionKey: text("plex_session_key").notNull().default(""),
    userId: integer("user_id").notNull(), // matches plex_users.userId; 0 when unknown
    username: text("username").notNull(),
    ratingKey: text("rating_key").notNull(),
    /** For episodes: the show. Denormalised so per-show queries need no Plex round trip. */
    grandparentRatingKey: text("grandparent_rating_key"),
    sectionId: text("section_id").notNull().default(""),
    title: text("title").notNull(),
    grandparentTitle: text("grandparent_title"),
    type: text("type").notNull(), // movie | episode | track
    /** Playback facts, kept because they are the whole point of a history panel. */
    player: text("player").notNull().default(""),
    platform: text("platform").notNull().default(""),
    decision: text("decision").notNull().default(""), // directplay | copy | transcode
    local: integer("local").notNull().default(0),
    startedAt: integer("started_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    endedAt: integer("ended_at"),
    durationMs: integer("duration_ms").notNull().default(0),
    /**
     * Sum of observed forward progress, not wall-clock. A paused session accrues
     * nothing and a seek backwards never subtracts, so this stays a lower bound
     * on time actually watched rather than drifting either way.
     */
    watchedMs: integer("watched_ms").notNull().default(0),
    viewOffsetMs: integer("view_offset_ms").notNull().default(0),
    completionPct: real("completion_pct").notNull().default(0),
    /** playing | paused | completed | abandoned | stale */
    state: text("state").notNull().default("playing"),
    /**
     * `poller` for rows we observed live, `plex-history` for rows reconstructed
     * from `/status/sessions/history/all` during backfill. Backfilled rows have
     * no completion or duration data and must never be treated as if they do —
     * consumers that need `watchedMs` filter on this.
     */
    source: text("source").notNull().default("poller"),
  },
  (table) => [
    index("idx_playback_user_started").on(table.userId, table.startedAt),
    index("idx_playback_rating_key").on(table.ratingKey),
    index("idx_playback_started").on(table.startedAt),
    // Open rows are read on every poll tick; this is the poller's hot path.
    index("idx_playback_open").on(table.endedAt),
    // Backfill dedupes against already-observed plays on this triple.
    index("idx_playback_dedupe").on(table.userId, table.ratingKey, table.startedAt),
  ],
);

/**
 * Per (item, user) rollup of `playback_sessions`, maintained incrementally as
 * sessions close rather than recomputed on read.
 *
 * The questions rules and collections ask are almost never "list the plays" but
 * "has this been watched, by whom, when" — and answering those by aggregating
 * the session log on every rule evaluation would put a full table scan inside
 * the generate loop. `rebuildWatchState()` in the playback domain recomputes it
 * from scratch for repair; it is a maintenance action, never automatic.
 *
 * Never pruned. `playback_sessions` ages out under `playback_retention_days`;
 * this is the summary that has to survive it.
 */
export const watchState = sqliteTable(
  "watch_state",
  {
    ratingKey: text("rating_key").notNull(),
    userId: integer("user_id").notNull(),
    plays: integer("plays").notNull().default(0),
    completedPlays: integer("completed_plays").notNull().default(0),
    firstPlayedAt: integer("first_played_at"),
    lastPlayedAt: integer("last_played_at"),
    totalWatchedMs: integer("total_watched_ms").notNull().default(0),
    /**
     * Furthest this user ever got, as a fraction of runtime — the high-water
     * mark across their plays, not an average and not the last one.
     *
     * Cannot be derived from the columns above: `totalWatchedMs` is cumulative,
     * so three ten-minute attempts at a two-hour film look identical to one
     * half-watched sitting. It also cannot be read back off `playback_sessions`
     * on demand, because that table ages out under `playback_retention_days`
     * and this one never does — the thing "abandoned below 20%" asks about is
     * precisely the play nobody has repeated in a year.
     */
    maxCompletionPct: real("max_completion_pct").notNull().default(0),
  },
  (table) => [
    uniqueIndex("idx_watch_state_pk").on(table.ratingKey, table.userId),
    index("idx_watch_state_user_last").on(table.userId, table.lastPlayedAt),
    index("idx_watch_state_rating_key").on(table.ratingKey),
  ],
);

/**
 * Items a cleanup rule has matched, and for how many runs in a row.
 *
 * A cleanup rule must never act on a first match. A metadata blip, a
 * half-finished library scan, or a smart filter that briefly matched too much
 * would otherwise be enough to delete a file, and there is no undo. So a match
 * is recorded here and the action only fires once the item has matched on
 * `consecutiveRuns` successive runs — the row is the memory that makes that
 * possible, and the surface the cleanup queue page reads to answer "what is
 * about to happen, and when".
 *
 * Rows are kept after the action fires rather than deleted: this doubles as the
 * audit trail for what a rule removed, which is the first thing anyone asks
 * afterwards. `ON DELETE CASCADE` on the rule is deliberate — a deleted rule's
 * queue is meaningless, and leaving orphans would resurrect them if an id were
 * ever reused.
 */
export const cleanupCandidates = sqliteTable(
  "cleanup_candidates",
  {
    ruleId: text("rule_id")
      .notNull()
      .references(() => rules.id, { onDelete: "cascade" }),
    ratingKey: text("rating_key").notNull(),
    sectionId: text("section_id").notNull(),
    title: text("title").notNull(),
    /** Consecutive runs matched. An item that stops matching has its row deleted. */
    streak: integer("streak").notNull().default(1),
    firstMatchedAt: integer("first_matched_at").notNull(),
    lastMatchedAt: integer("last_matched_at").notNull(),
    /** Set when the action fired. The row survives as an audit trail. */
    actionedAt: integer("actioned_at"),
    /** "" until actioned, then the mode that ran: label | collection_only | unmonitor | delete. */
    action: text("action").notNull().default(""),
    /**
     * User-set reprieve — never action this item before this timestamp.
     *
     * Without it the only way to rescue one film from a rule is to edit the
     * rule itself, which nobody is going to do carefully at 1am.
     */
    heldUntil: integer("held_until"),
  },
  (table) => [
    uniqueIndex("idx_cleanup_candidates_pk").on(table.ruleId, table.ratingKey),
    index("idx_cleanup_candidates_rule_streak").on(table.ruleId, table.streak),
    // The queue page reads across every rule, ordered by what is closest to
    // being actioned.
    index("idx_cleanup_candidates_actioned").on(table.actionedAt, table.streak),
  ],
);

/**
 * What has been sent, to whom, for which period.
 *
 * This is the idempotency guarantee, not a log. A digest job that fails
 * halfway through its recipients will be retried, and without a ledger the
 * retry re-sends to everyone it already reached — which for an email digest
 * means people get the same newsletter twice and stop trusting the channel.
 * The unique index does the work: an insert that conflicts means "already
 * sent", full stop, and the send is skipped without any further reasoning.
 *
 * `skipped_empty` rows are recorded rather than omitted, so "why didn't I get
 * one this week" has an answer that isn't a shrug.
 */
export const digestDeliveries = sqliteTable(
  "digest_deliveries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    periodStart: integer("period_start").notNull(),
    periodEnd: integer("period_end").notNull(),
    /** 0 for the server-wide digest sent to the admin's own channels. */
    userId: integer("user_id").notNull().default(0),
    /** email | discord | slack | … — a notification service, or `email`. */
    channel: text("channel").notNull(),
    /** sent | failed | skipped_empty */
    status: text("status").notNull(),
    itemCount: integer("item_count").notNull().default(0),
    error: text("error").notNull().default(""),
    sentAt: integer("sent_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_digest_deliveries_unique").on(table.periodStart, table.userId, table.channel),
    index("idx_digest_deliveries_sent").on(table.sentAt),
  ],
);
