import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";

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

/** One season of a Sonarr series, denormalised onto `arr_series.seasons`. */
interface ArrSeasonShape {
  seasonNumber: number;
  monitored: boolean;
  episodeCount: number;
  episodeFileCount: number;
  sizeOnDisk: number;
}

/**
 * The JSON columns of `stress_test_runs`, mirrored from the zod schemas in
 * `packages/jobs/src/stress-test/index.ts` — which are the authority. They are
 * duplicated rather than imported because `packages/db` sits below `packages/jobs`
 * in the layering, and a type-level assertion in `stress-test/schema.test.ts`
 * fails the build if the two drift.
 *
 * Fields marked optional were added after rows already existed, so the readers
 * treat their absence as "not recorded" rather than reparsing history.
 */
interface StressTestConfigShape {
  mode: "transcode" | "directplay" | "mixed";
  transcodePct?: number;
  maxSessions?: number;
  verbose?: boolean;
}

interface StressTestStepShape {
  step: number;
  sessions: number;
  avgTranscodeSpeed: number | null;
  avgBandwidth: number;
  /** Failed `/status/sessions` samples during this step. */
  errors: number;
  timestamp: number;
  /** How many of our sessions Plex actually reported. */
  sessionsSeen?: number;
  /** Stream fetch failures the simulated clients saw during the sample window. */
  streamErrors?: number;
  /** Why the ramp stopped here, if it did. */
  reason?: string | null;
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
  /**
   * Where this rule sits in the running order. Lower runs first.
   *
   * Order was `createdAt` and nothing else, which is fine until two rules
   * disagree — and nothing stopped them. Two rules can write the same
   * metadata field on the same item, and whichever ran second won for a
   * reason nobody could see or change. Two rules can produce collections of
   * the same name, which Plex allows: you get two, both called "Top Rated",
   * and the one you see depends on the order they were built in.
   *
   * Defaulting to 0 keeps existing installs on their current order — every
   * rule ties, and `createdAt` remains the tiebreak, which is exactly what it
   * was before.
   */
  position: integer("position").notNull().default(0),
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
   * purpose — a run once deleted and recreated the rule's collections, so keys
   * did not survive between runs while names did. Reconciling keeps most keys
   * stable now, but a collection rebuilt after heavy churn still gets a new
   * one, and the name is what the rotation is about either way.
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
  /**
   * When this rule's own cron last fired, for rules that have one.
   *
   * Separate from `lastRunAt` on purpose: that moves for a manual run too, and
   * using it would let pressing "Run now" at 02:59 swallow the 03:00 scheduled
   * run. The scheduler compares the cron's previous occurrence against this,
   * so only a scheduled fire counts as having satisfied the schedule.
   */
  lastScheduledAt: integer("last_scheduled_at"),
  /**
   * When this rule's collections were last torn down for being outside the
   * rule's calendar window. Null once it is back inside, so re-entering and
   * leaving the window again tears down again.
   */
  windowClearedAt: integer("window_cleared_at"),
});

/**
 * Cross-context mutex for "this rule is generating collections right now".
 *
 * Two overlapping runs of one rule interleave their writes to the same
 * collections: each reads the membership, computes a diff against it, and
 * applies it, so the second one's diff is stale by the time it lands. When a
 * run was delete-then-recreate the damage was starker still — both deleted
 * before either created, and both creations survived as duplicate same-title
 * collections. The runs that overlap live in different execution contexts —
 * the `generate` command runs in a Sidequest worker thread, ad-hoc single-rule
 * runs execute in the API process — so an in-process Map cannot see both.
 * SQLite can.
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

/**
 * A named list view — the search, filters and sort of a page, under a name.
 *
 * `useListParams` already keeps every list page's state in the URL, which
 * makes a view nothing more than a stored query string. That is the whole
 * design: no per-page schema, no migration when a page gains a filter, and a
 * view is shareable as a plain link whether or not it was ever saved.
 *
 * Keyed by `page` rather than a global namespace so "Unwatched 4K" on Media
 * and "Unwatched 4K" on Collections are two views, not a collision.
 */
export const savedViews = sqliteTable(
  "saved_views",
  {
    id: text("id").primaryKey(),
    /** Which list page this belongs to — "media", "collections", … */
    page: text("page").notNull(),
    name: text("name").notNull(),
    /** The URL query string, minus the leading "?". */
    query: text("query").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("idx_saved_views_page_name").on(table.page, table.name)],
);

/**
 * Rules that were deleted recently enough to put back.
 *
 * Every destructive path in the app was a confirmation dialog and nothing
 * else, which is exactly the design that trains people to click through
 * without reading. A rule is the most expensive thing here to lose — a smart
 * filter someone spent an hour composing — and it is also the easiest to
 * restore, because the whole of it is one config blob.
 *
 * Not a `deleted_at` column on `rules`: every query in the app would then have
 * to remember to exclude tombstones, and the one that forgot would show a
 * deleted rule as live. A separate table is only visible to code that asks
 * for it.
 *
 * The rule's collections in Plex are *not* restored. They were deleted from
 * Plex by the delete and the next run rebuilds them; saying so is the
 * restore's job, not this table's.
 */
export const deletedRules = sqliteTable(
  "deleted_rules",
  {
    /** The id the rule had, so a restore puts it back under its own identity. */
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    enabled: integer("enabled").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    /**
     * Where the rule sat in the running order when it was deleted.
     *
     * Carried on the tombstone because position decides which rule wins when
     * two disagree. Without it a restore fell back to the column default, 0 —
     * so undoing a delete moved the rule to the *front* of the order, where it
     * now won every conflict it used to lose. A restore has to put a rule back
     * where it was, not just back.
     *
     * Nullable for tombstones written before this column existed; a restore
     * treats null as "no better answer than the default".
     */
    position: integer("position"),
    registryRuleSlug: text("registry_rule_slug"),
    registryPackSlug: text("registry_pack_slug"),
    registryVersion: integer("registry_version"),
    registryConfigHash: text("registry_config_hash"),
    deletedAt: integer("deleted_at").notNull(),
  },
  (table) => [index("idx_deleted_rules_deleted_at").on(table.deletedAt)],
);

/**
 * The membership a rule's collection had at the end of its last run.
 *
 * Plex itself cannot answer "what changed": it holds the membership a run left
 * behind and no record of what preceded it, and a collection rebuilt after
 * heavy churn is a new object entirely. This is that memory: one row per
 * collection a rule owns,
 * overwritten at the end of each commit, and read at the start of the next one
 * to produce `ruleRunChanges` below.
 *
 * Keyed by NAME rather than rating key for the same reason `lastPinnedCollections`
 * is — rating keys don't survive a delete-and-recreate cycle, names do.
 */
export const ruleCollectionMembers = sqliteTable(
  "rule_collection_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ruleId: text("rule_id")
      .notNull()
      .references(() => rules.id, { onDelete: "cascade" }),
    sectionKey: text("section_key").notNull(),
    collectionName: text("collection_name").notNull(),
    members: text("members", { mode: "json" }).$type<{ ratingKey: string; title: string }[]>().notNull().default([]),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_rule_members_unique").on(table.ruleId, table.sectionKey, table.collectionName)],
);

/**
 * What one run did to one collection, item by item.
 *
 * The counts on `rule_runs` say a rule produced 40 collections and 900 items;
 * they cannot say that "Sci-Fi Gems" lost fourteen titles because an OMDb
 * rating moved. This table answers that, and is what makes a run revertable —
 * the revert is "put the removed ones back, take the added ones out again".
 *
 * `change` is "added" | "removed". A run that changed nothing writes no rows,
 * so the common steady-state night costs nothing.
 */
export const ruleRunChanges = sqliteTable(
  "rule_run_changes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id").notNull(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => rules.id, { onDelete: "cascade" }),
    sectionKey: text("section_key").notNull(),
    sectionTitle: text("section_title").notNull(),
    collectionName: text("collection_name").notNull(),
    /** The Plex key of the collection as it existed at the end of this run. */
    collectionRatingKey: text("collection_rating_key"),
    itemRatingKey: text("item_rating_key").notNull(),
    itemTitle: text("item_title").notNull(),
    change: text("change").notNull(),
    at: integer("at").notNull(),
  },
  (table) => [
    index("idx_rule_run_changes_run").on(table.runId),
    index("idx_rule_run_changes_rule_at").on(table.ruleId, table.at),
  ],
);

/**
 * One row per execution of a single rule — the durable counterpart to the
 * `last_run_*` columns on `rules`, which only ever remember the most recent one.
 *
 * This exists because a rule run had no server-visible existence: progress lived
 * in a Map in the API process, so a run was invisible to every other tab, to the
 * Sidequest worker thread, and to the same tab after a reload. A run big enough
 * to be worth watching — a thousand collections, twenty minutes — was exactly the
 * kind that disappeared.
 *
 * Deliberately shaped like `jobRuns` below: same log/progress/message triple,
 * same append-only log writes, same "active status vs terminal status" split. The
 * terminal statuses match `rules.lastRunStatus` ("ok" | "error" | "cancelled") so
 * the denormalised summary on `rules` stays written the way it always was.
 *
 * Nullable: `jobRunId` (null for manual runs), the count columns and `error`
 * (nothing to report until the run ends), `finishedAt` (null while in progress).
 */
export const ruleRuns = sqliteTable(
  "rule_runs",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => rules.id, { onDelete: "cascade" }),
    /** "run" | "test" — a test is a dry run, and worth the same durability. */
    phase: text("phase").notNull(),
    /** "manual" | "job" — a UI press, or a slice of a Generate/Cleanup job. */
    trigger: text("trigger").notNull(),
    /**
     * The `job_runs.id` this rule run belongs to, when a job owns it. No FK: job
     * runs are pruned on their own retention schedule, and a rule run outliving
     * its parent should keep its own history rather than be deleted with it.
     */
    jobRunId: text("job_run_id"),
    /** "queued" | "running" | "cancelling" → "ok" | "error" | "cancelled". */
    status: text("status").notNull().default("queued"),
    log: text("log").notNull().default(""),
    progress: real("progress").notNull().default(0),
    message: text("message").notNull().default(""),
    collectionCount: integer("collection_count"),
    itemCount: integer("item_count"),
    error: text("error"),
    /**
     * Where the items went, clause by clause — one entry per library.
     *
     * Only written when a smart-filter rule finishes a *real* run having
     * matched nothing, which is the one moment the answer is worth the cost
     * (one Plex count per clause per section). A run that matched something
     * has no attrition worth attributing, and paying for this on every rule
     * every night would be minutes of counting to explain nothing.
     *
     * Shape is `TestFunnelSection[]` from domain.rule-runs. Stored rather than
     * recomputed because by the time anyone reads a `rule.empty` notification
     * the library has moved on, and a funnel measured this morning would not
     * be the funnel that produced last night's zero.
     */
    funnel: text("funnel", { mode: "json" }).$type<unknown>(),
    startedAt: integer("started_at").notNull(),
    /**
     * Heartbeat, pushed forward by every log/progress flush. A worker thread that
     * dies without taking the process down leaves a row that is `running` and
     * silent; the watchdog uses the gap since this to tell that from a run that
     * is simply quiet between steps.
     */
    updatedAt: integer("updated_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (table) => [
    index("idx_rule_runs_rule_started").on(table.ruleId, table.startedAt),
    index("idx_rule_runs_status_started").on(table.status, table.startedAt),
    index("idx_rule_runs_job_run").on(table.jobRunId),
  ],
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
    /**
     * How a failed run failed, when it wasn't the command's own doing.
     *
     * `"watchdog"` — the sweep force-failed it for blowing its budget without
     * unwinding. `"cancel-timeout"` — a cancellation that never completed.
     * Null for every ordinary failure, which is the command throwing.
     *
     * The distinction is not cosmetic: a watchdog failure means the run may
     * still be executing inside a worker thread we cannot interrupt, and it
     * reads in the UI as "Tinkerbell gave up on it", not "your rule is wrong".
     * Previously this was only recoverable by grepping the log for
     * `[watchdog]`.
     */
    failureKind: text("failure_kind"),
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

/**
 * What Tinkerbell has written onto a generated collection's *presentation* —
 * its summary and its poster — and what it found there first.
 *
 * Keyed by `(ruleId, collectionName)` rather than by rating key, for the same
 * reason as `rules.lastPinnedCollections`: rating keys did not survive a run
 * when a run meant delete-and-recreate, and a rebuilt collection still gets a
 * fresh one today. Names survive both.
 *
 * Two jobs it does that the Plex server can't:
 *
 *  - `inputHash` covers (template, title, palette, member poster keys). An
 *    unchanged hash means the image we'd render is the image already up there,
 *    so the upload is skipped — a nightly run over 200 collections otherwise
 *    re-uploads 200 identical JPEGs to a home server every night.
 *  - `summary` is the last text *we* wrote. When what's on the collection
 *    differs from it, a person edited it by hand, and the next run leaves it
 *    alone. Overwriting a hand-written summary every night is the kind of
 *    thing that makes people uninstall.
 */
export const collectionArtwork = sqliteTable(
  "collection_artwork",
  {
    ruleId: text("rule_id")
      .notNull()
      .references(() => rules.id, { onDelete: "cascade" }),
    collectionName: text("collection_name").notNull(),
    /** Hash of (template, title, palette, member poster keys) — skip the upload when unchanged. */
    inputHash: text("input_hash").notNull().default(""),
    summary: text("summary").notNull().default(""),
    /** "template" | "llm" | "custom" | "source" — provenance, and the LLM cache key's other half. */
    summarySource: text("summary_source").notNull().default(""),
    /** Config hash the cached `summary` was generated against. A change invalidates it. */
    summaryConfigHash: text("summary_config_hash").notNull().default(""),
    /** Set when a person edited the summary in Plex; we stop writing it after that. */
    summaryLockedAt: integer("summary_locked_at"),
    posterUploadedAt: integer("poster_uploaded_at"),
    /**
     * Set when a person chose this collection's poster by hand, in the app.
     * The symmetric case to `summaryLockedAt`, and for the same reason: a
     * nightly job that silently replaces artwork somebody picked is worse than
     * one that never offered to set it.
     */
    posterLockedAt: integer("poster_locked_at"),
    /**
     * Whether the collection already had artwork before Tinkerbell first
     * uploaded to it, and where. A collection used to be recreated every run,
     * which made "revert" mostly mean "stop uploading"; now that one usually
     * survives, there is genuinely something to put back — and the affordance
     * has to be honest about what it can restore, which requires having looked.
     */
    priorThumb: text("prior_thumb").notNull().default(""),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_collection_artwork_pk").on(table.ruleId, table.collectionName)],
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
    /**
     * Bytes on disk, summed across every version and every part.
     *
     * Summed rather than taken from the first part, because an item with two
     * versions occupies both — and the number's whole purpose is to answer
     * "how much do I get back if this goes", where the answer is all of it.
     *
     * For a show this is the sum over its episodes. Plex hangs no `Media` off a
     * show row — the files belong to the episodes — so the sync walks a TV
     * section a second time at episode level and rolls the totals up onto the
     * show. It is one extra paged walk per TV library per sync, which is what
     * "how much room do my shows take" costs; the alternative was a column that
     * was null for every show.
     *
     * Still null wherever nothing could be read: an item Plex reports no parts
     * for, a show whose episodes all lack sizes, or a section whose episode
     * walk failed. Null is "unknown", never zero — zero is a claim a storage
     * total would happily add up, and every consumer says "unknown" instead.
     */
    fileSize: integer("file_size"),
    /**
     * Episodes Plex reports for a show (`leafCount`). Null for movies, and for a
     * show Plex didn't count.
     *
     * Stored because the library stats used to count `type = 'episode'` rows —
     * and there are none. The sync walks a section's top-level rows, so a TV
     * library indexes shows, never episodes: "~0 episodes each" on the Shows
     * tile and "100% movies" on the library split were both structural, not a
     * missing sync. The number comes free in the listing already being paged.
     */
    leafCount: integer("leaf_count"),
    /**
     * Episodes of this show whose size Plex wouldn't report. Null for movies and
     * for anything not measured at episode level.
     *
     * `fileSize` above is the sum of what *could* be read, so a show with two of
     * four episodes sized carries a real but incomplete number. Without this
     * column that show counted as fully sized, and the Storage panel showed a
     * total short by half with no caveat at all — the panel's own caveat line
     * exists precisely to say "N items couldn't be accounted for".
     */
    sizeUnknownParts: integer("size_unknown_parts"),
    /** Overall bitrate in kbps, as Plex reports it for the first version. */
    bitrate: integer("bitrate"),
    /**
     * How many versions Plex holds for this item.
     *
     * The classic Plex duplicate is one item with two files behind it, which
     * is invisible from every other column here — the resolution and codec
     * columns describe the first version only, so a 4K remux and a 720p rip
     * of the same film look like one tidy 4K row.
     */
    versionCount: integer("version_count").notNull().default(1),
    /**
     * Provider ids, verbatim as Plex serves them: `["tmdb://603", "imdb://tt0133093"]`.
     *
     * Kept alongside the three parsed columns below rather than instead of them.
     * The parsed columns are what joins index on; this is the provenance, and
     * the only thing that still answers the question when a fourth provider
     * turns up that no column exists for yet.
     */
    guids: text("guids", { mode: "json" }).$type<string[]>(),
    /**
     * The parsed provider ids — the join key to `arr_movies` / `arr_series`.
     *
     * Three columns rather than one canonical `external_id`, because there is
     * no single canonical answer: Radarr indexes on TMDb and Sonarr on TVDb, so
     * a movie matched by `tmdb_id` and a show matched by `tvdb_id` are both the
     * normal case. Collapsing them to one preferred id would silently fail to
     * link exactly the half of the library whose preference went the other way.
     *
     * Nullable throughout: an unmatched Plex item carries no provider id at all,
     * and null means "unknown", never "no match".
     */
    tmdbId: integer("tmdb_id"),
    imdbId: text("imdb_id"),
    tvdbId: integer("tvdb_id"),
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
    // "What is taking up the room" is a sort over the whole library.
    index("idx_media_items_file_size").on(table.fileSize),
    // The *Arr join. Every reconciliation query and every "is this in Plex?"
    // lookup goes through one of these three.
    index("idx_media_items_tmdb_id").on(table.tmdbId),
    index("idx_media_items_imdb_id").on(table.imdbId),
    index("idx_media_items_tvdb_id").on(table.tvdbId),
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
    /** Links the title to its media page. Null for rows synced before this was recorded. */
    lastWatchedRatingKey: text("last_watched_rating_key"),
    lastWatchedAt: integer("last_watched_at"),
    /**
     * The server owner. Recorded at sync time because the alternative — asking
     * plex.tv on every rule evaluation — puts a network round trip inside the
     * generate loop for a fact that changes approximately never. Rules that
     * define "everyone" need it: the owner's consumption pattern is usually
     * nothing like a shared user's, so they are excluded by default.
     */
    isOwner: integer("is_owner").notNull().default(0),
    /** Nullable: Plex omits an email for managed users, who have no account. */
    email: text("email"),
    thumb: text("thumb"),
    /** In the owner's Plex Home. */
    isHome: integer("is_home").notNull().default(0),
    /** A managed profile rather than a full Plex account. Implies `isHome`. */
    isManaged: integer("is_managed").notNull().default(0),
    /** PIN-protected. The PIN itself is write-only on Plex's side. */
    isProtected: integer("is_protected").notNull().default(0),
    /**
     * The share id, not the user id. `PUT`/`DELETE .../shared_servers/{id}`
     * are keyed by it, so without it neither the library picker nor the
     * unshare action has anything to address. Null for the owner and for Home
     * users who reach the server through the Home rather than a share.
     */
    sharedServerId: integer("shared_server_id"),
    /** False while an invite is outstanding. */
    accepted: integer("accepted").notNull().default(1),
    syncedAt: integer("synced_at").notNull(),
  },
  (table) => [index("idx_plex_users_username").on(table.username)],
);

/**
 * What each user can currently see, mirrored from plex.tv so the list renders
 * without a round trip. The detail page re-reads plex.tv live — share state
 * changes out-of-band from the Plex web app, and a stale library list that
 * silently lies is worse than a slower page.
 */
export const plexUserShares = sqliteTable("plex_user_shares", {
  userId: integer("user_id").primaryKey(),
  /** JSON array of library section keys. Empty means every library. */
  sectionIds: text("section_ids", { mode: "json" }).$type<number[]>().notNull().default([]),
  allowSync: integer("allow_sync").notNull().default(0),
  allowTuners: integer("allow_tuners").notNull().default(0),
  allowChannels: integer("allow_channels").notNull().default(0),
  allowCameraUpload: integer("allow_camera_upload").notNull().default(0),
  /** Verbatim plex.tv filter strings — `contentRating=PG|label=Tinkerbell`. */
  filterMovies: text("filter_movies").notNull().default(""),
  filterTelevision: text("filter_television").notNull().default(""),
  filterMusic: text("filter_music").notNull().default(""),
  syncedAt: integer("synced_at").notNull(),
});

/**
 * Invites with no accepted user behind them yet, so the users list can show a
 * pending row. Plex has no webhook for acceptance — it is discovered by the
 * `sync-users` poll, at which point the row disappears in favour of a real
 * `plex_users` row.
 */
export const plexInvites = sqliteTable("plex_invites", {
  id: integer("id").primaryKey(),
  /** `sent` is an invite we issued; `received` is one waiting on the owner. */
  direction: text("direction").notNull(),
  username: text("username").notNull().default(""),
  email: text("email").notNull().default(""),
  thumb: text("thumb"),
  createdAt: integer("created_at"),
  syncedAt: integer("synced_at").notNull(),
});

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
  /**
   * Consent to a personalised home screen, per user.
   *
   * Defaults to 0 — *not* consented. It defaulted to 1, which is the wrong way
   * round for a consent column: any insert that omitted it would have opted
   * somebody in silently. Latent, because every writer passes it explicitly and
   * `getUserPreferences` already reports `false` for a user with no row at all,
   * but a default is exactly the sort of thing a future writer trusts.
   */
  optedIn: integer("opted_in").notNull().default(0),
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

/**
 * Live streaming bandwidth over time — one row per playback poll.
 *
 * Separate from `bandwidth_tests`, which measures the *link* a few times a
 * year. This measures what is being *used*, every 30 seconds, and the two only
 * mean something together: 24 Mbps is idle on a gigabit line and saturation on
 * a 30/10 one.
 *
 * Deliberately not derived from `playback_sessions`. That table records what
 * played, not what it cost — a paused session still holds its bitrate, and a
 * transcode's bandwidth bears no relation to the file's. Both are only
 * knowable at poll time, from Plex's own figure.
 */
export const bandwidthSamples = sqliteTable(
  "bandwidth_samples",
  {
    /** Poll time. The natural key: the poller writes at most one row per tick. */
    sampledAt: integer("sampled_at").primaryKey(),
    /** Sum of every active session's bandwidth, in kbps — Plex's unit. */
    kbps: integer("kbps").notNull().default(0),
    /** How many sessions that was spread across, so a spike can be read. */
    streams: integer("streams").notNull().default(0),
  },
  (table) => [index("idx_bandwidth_samples_sampled").on(table.sampledAt)],
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
    /**
     * When a human said yes to this specific item.
     *
     * Only consulted by rules with `requireApproval`, where it is the
     * difference between "this rule may delete" and "this rule may delete
     * *these*". Cleared when the item leaves the queue, so an approval never
     * outlives the streak that earned it.
     */
    approvedAt: integer("approved_at"),
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
 * Things a cleanup rule must never action, whatever its filter says.
 *
 * The queue already had a reprieve, but every reprieve expires — deliberately,
 * so a rule that keeps re-matching something comes back for review instead of
 * being silently overruled forever. That is the right default and the wrong
 * only option: "this film never goes" and "nothing in Favourites ever goes"
 * are permanent facts about a library, not decisions to be re-taken every
 * ninety days by someone who has forgotten why they made them.
 *
 * Two kinds, both answerable from the local index so that the queue page and
 * the engine cannot disagree about what is protected:
 *
 * - `item` — one rating key.
 * - `collection` — every member of a collection, matched on title so the
 *   protection survives the collection being rebuilt with a new rating key,
 *   which is exactly what Tinkerbell's own rules do to it nightly.
 *
 * Protection by Plex *label* is the obvious third and is deliberately absent:
 * item labels are not in the local index, so it could only be answered by
 * asking Plex during a run, and a protection the queue page cannot evaluate
 * is one that shows the wrong answer right up until something is deleted.
 */
export const cleanupProtections = sqliteTable(
  "cleanup_protections",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").notNull(),
    /** A rating key, or a collection title folded to lower case. */
    value: text("value").notNull(),
    /** What it looked like when it was added — for display. */
    label: text("label").notNull().default(""),
    /** Why, in the words of whoever added it. */
    note: text("note").notNull().default(""),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("idx_cleanup_protections_unique").on(table.kind, table.value)],
);

/**
 * "Please don't delete this" — from the people who watch, not the person who
 * configures.
 *
 * A vote is a signal, deliberately not a hold. A shared user pressing a button
 * in the portal must not be able to silently overrule the server owner's rule;
 * equally, an owner deleting six films while three people were quietly hoping
 * to watch one is the outcome the cleanup queue exists to prevent. So the vote
 * is recorded and shown on the queue beside the item, and the decision stays
 * exactly where it was.
 *
 * One vote per person per item — the unique index makes pressing it twice
 * idempotent rather than a way to stuff the ballot.
 */
export const cleanupKeepVotes = sqliteTable(
  "cleanup_keep_votes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ratingKey: text("rating_key").notNull(),
    /** Plex user id, so a renamed account keeps its votes. */
    userId: integer("user_id").notNull(),
    /** Denormalised for display: the queue shows who asked. */
    username: text("username").notNull(),
    votedAt: integer("voted_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_cleanup_keep_votes_unique").on(table.ratingKey, table.userId),
    index("idx_cleanup_keep_votes_item").on(table.ratingKey),
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

/**
 * Every metadata field Tinkerbell has written to a Plex item, and what it
 * found there first.
 *
 * `overlay_originals` establishes the pattern — snapshot before mutate — and
 * metadata needs it more than posters do. A poster can be regenerated; a
 * hand-curated sort title cannot. A bad run over 5,000 items with locks set is
 * genuinely destructive to data nobody else holds a copy of.
 *
 * Three details carry the weight:
 *
 *  - `batchId` groups every row one run wrote, so undo is per-run and atomic
 *    in intent. Undoing "that 2am run" is the thing a person actually wants;
 *    undoing one field on one item is not.
 *  - `previousLocked` is recorded alongside the value because restoring the
 *    text and leaving the lock set would hand back a field that Plex has
 *    stopped maintaining — a revert that isn't one.
 *  - Rows are written *before* the write lands and are committed even if it
 *    then fails, so a batch that died halfway is still fully revertible.
 *
 * `revertedAt` marks a row as spent rather than deleting it. Undoing twice
 * must be a no-op, not a double-revert, and the history is the audit trail
 * someone reads when a title looks wrong.
 */
export const metadataOriginals = sqliteTable(
  "metadata_originals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    batchId: text("batch_id").notNull(),
    /** Null for a manual edit from the Media page. */
    ruleId: text("rule_id"),
    ratingKey: text("rating_key").notNull(),
    sectionId: text("section_id").notNull(),
    sectionType: text("section_type").notNull().default("movie"),
    /** Item title as it was at write time, so the undo UI can name what it touched. */
    itemTitle: text("item_title").notNull().default(""),
    /** A scalar field name (`titleSort`) or a tag field (`genre`). */
    field: text("field").notNull(),
    /** "scalar" | "tag" — decides how a revert is applied. */
    fieldKind: text("field_kind").notNull().default("scalar"),
    /** Null = the field was unset. Tag sets are stored as a JSON array. */
    previousValue: text("previous_value"),
    previousLocked: integer("previous_locked").notNull().default(0),
    newValue: text("new_value"),
    appliedAt: integer("applied_at").notNull(),
    revertedAt: integer("reverted_at"),
  },
  (table) => [
    index("idx_metadata_originals_batch").on(table.batchId),
    index("idx_metadata_originals_item").on(table.ratingKey),
    // The undo list groups batches newest first and hides spent ones.
    index("idx_metadata_originals_applied").on(table.appliedAt),
  ],
);

/**
 * An uploaded (or server-read) Kometa config bundle, held between the moment
 * the user hands it over and the moment they finish reviewing the plan it
 * produced.
 *
 * Deliberately a table rather than another `config` key. The migration state
 * slots next door are small scalars, and `config` is read wholesale on boot —
 * a real Kometa `config/` directory is a `config.yml` plus a dozen collection
 * files and runs to hundreds of kilobytes, which is not something to drag
 * into memory on every process start for the sake of one settings page.
 *
 * `planCache` exists because mapping is not cheap: template expansion runs
 * over every definition, and the review screen re-queries the plan on every
 * checkbox render. The cache is keyed by nothing — a row *is* one import, and
 * an import's files never change, so a cached plan can't go stale against its
 * own bundle. It can go stale against the *library mapping*, which is why the
 * runtime clears it when the section mapping changes.
 *
 * Rows are disposable. Nothing downstream reads them once `migration_pending_plan`
 * is written, so the sweep that purges old job runs can drop these too.
 */
export const migrationImports = sqliteTable(
  "migration_imports",
  {
    id: text("id").primaryKey(),
    /** Provider that owns this bundle, e.g. "kometa-yaml". */
    providerId: text("provider_id").notNull(),
    createdAt: integer("created_at").notNull(),
    /**
     * The bundle, as `{ path, text }` pairs. `path` is whatever the user's
     * directory picker reported, kept verbatim so include resolution can match
     * on it the way Kometa's own `file:`/`folder:` references expect.
     */
    files: text("files", { mode: "json" }).$type<Array<{ path: string; text: string }>>().notNull().default([]),
    /** Parse/resolve findings, surfaced by the Resolve step before any mapping. */
    diagnostics: text("diagnostics", { mode: "json" })
      .$type<Array<{ severity: "error" | "warn" | "info"; file?: string; line?: number; message: string }>>()
      .notNull()
      .default([]),
    /**
     * Kometa library name → Plex section id, as confirmed by the user. Empty
     * until they get through the Resolve step; mapping can't be inferred
     * reliably because Kometa keys libraries by Plex section *title*, which
     * drifts.
     */
    sectionMap: text("section_map", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
    /** Last built plan for this bundle. Null until the first preview. */
    planCache: text("plan_cache", { mode: "json" }).$type<unknown>(),
  },
  (table) => [
    // The Migrate page asks for "the newest import for this provider".
    index("idx_migration_imports_provider").on(table.providerId, table.createdAt),
  ],
);

/**
 * A metadata edit somebody made by hand, kept so it can be re-applied.
 *
 * This exists because of migration, but it isn't only for migration. Kometa's
 * `metadata_files` are the least reproducible thing in a config — a collection
 * can be rebuilt from a rule, but nobody is retyping four hundred summaries —
 * and the only honest way to migrate them was to give Tinkerbell somewhere to
 * put them.
 *
 * Two decisions worth stating:
 *
 *  - **Matched, not resolved.** An override stores what its author wrote — a
 *    title, maybe a year, maybe an IMDb id — and `ratingKey` is filled in once
 *    something matched. Storing only the rating key would mean an override
 *    silently detaching whenever a library is rebuilt, which is exactly when
 *    somebody most wants their hand-written summaries back.
 *  - **Applied, not merged.** Tag fields replace the whole set, because that
 *    is what Kometa's metadata files mean by them. The undo ledger
 *    (`metadata_originals`) records what was there first, so this is
 *    reversible in the same way every other metadata write is.
 */
export const metadataOverrides = sqliteTable(
  "metadata_overrides",
  {
    id: text("id").primaryKey(),
    /** Plex section this override belongs to. */
    sectionId: text("section_id").notNull(),
    /** Title as written by whoever made the override. */
    matchTitle: text("match_title").notNull(),
    matchYear: integer("match_year"),
    matchImdb: text("match_imdb"),
    matchTmdb: integer("match_tmdb"),
    /** Filled in once the override has been matched to a real item. */
    ratingKey: text("rating_key"),
    /** Scalar fields, `{ titleSort: "Star Wars 01" }`. */
    fields: text("fields", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
    /** Tag sets, replaced wholesale on apply. */
    tags: text("tags", { mode: "json" }).$type<Record<string, string[]>>().notNull().default({}),
    /** Where it came from, for the UI: "kometa" or "manual". */
    source: text("source").notNull().default("manual"),
    /** Null until applied; set to the run that wrote it. */
    appliedAt: integer("applied_at"),
    /** Why the last apply didn't happen — "no match", a Plex error. */
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_metadata_overrides_section").on(table.sectionId),
    // The apply job walks unapplied overrides first.
    index("idx_metadata_overrides_applied").on(table.appliedAt),
    // Re-importing the same config must update rather than duplicate.
    uniqueIndex("idx_metadata_overrides_match").on(table.sectionId, table.matchTitle, table.matchYear),
  ],
);

/**
 * Playlists Tinkerbell built, and which rule owns each one.
 *
 * Collections carry a `Rule:<id>` label, which is how every other part of this
 * app knows what it owns. **Playlists cannot be labelled** — Plex has no such
 * field on them — so ownership has to live here instead.
 *
 * That makes this table load-bearing in a way the collections mirror isn't: if
 * it were lost, a rule would create a second playlist beside the one it already
 * owns rather than updating it. Two mitigations: the rule id is also written
 * into the playlist's summary as a marker, so ownership can be recovered by
 * scanning; and the update path clears and refills in place rather than
 * deleting, so the worst case is a duplicate rather than a destroyed playlist.
 */
export const managedPlaylists = sqliteTable(
  "managed_playlists",
  {
    /** Plex's own key. Stable across updates — see the note above. */
    ratingKey: text("rating_key").primaryKey(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => rules.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    itemCount: integer("item_count").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_managed_playlists_rule").on(table.ruleId)],
);

/**
 * How the things you configured came to be the way they are.
 *
 * Every other ledger in this schema records what Tinkerbell did to *Plex* —
 * collection membership in `rule_run_changes`, metadata writes in
 * `metadata_originals`, deletions in `cleanup_candidates`, overlay burn-ins in
 * `overlay_originals`. None of them records what *you* did to Tinkerbell. A
 * rule edited at 2am that starts producing nonsense had no diff and no previous
 * version, and a config value nobody remembers changing had no history at all.
 *
 * Whole snapshots rather than field-level diffs. Rules are a few kilobytes,
 * storage is free, and reconstructing a version from a chain of diffs is
 * exactly the code nobody wants to be debugging when they are already having a
 * bad night. The diff is computed for display, at read time.
 *
 * Nothing here is written directly: `domains/config-history` owns the writes and
 * is reached through `ChangeRecorderToken`, so a config value that skipped
 * redaction cannot be introduced by a new call site.
 */
export const changeLog = sqliteTable(
  "change_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** One of `CHANGE_LOG_ENTITIES` — "rule", "config", "job", … */
    entity: text("entity").notNull(),
    /** The rule id, the config key, the job id. Free text; entities disagree. */
    entityId: text("entity_id").notNull(),
    /** One of `CHANGE_LOG_ACTIONS` — "create", "update", "delete", … */
    action: text("action").notNull(),
    /**
     * The whole row as it stood *before*. Null for a create.
     *
     * Secrets are redacted on the way in for both this and `after` — without
     * that, this table would be a plaintext history of every API key ever
     * entered, which is strictly worse than the single plaintext copy in
     * `config` that it would be describing.
     */
    before: text("before", { mode: "json" }).$type<unknown>(),
    /** The whole row as it stands after. Null for a delete. */
    after: text("after", { mode: "json" }).$type<unknown>(),
    /** Who or what did it: "ui", "job:<name>", "import", "registry", "restore". */
    source: text("source").notNull().default("ui"),
    /**
     * The admin who did it, when admin auth is on and the change came from a
     * request. Empty for jobs, for imports, and for every install that has not
     * enabled auth — which is why it is a defaulted column and not nullable.
     */
    username: text("username").notNull().default(""),
    timestamp: integer("timestamp").notNull(),
  },
  (table) => [
    // The per-entity history view: "this rule, newest first".
    index("idx_change_log_entity").on(table.entity, table.entityId, table.timestamp),
    // The global feed, and the retention sweep.
    index("idx_change_log_timestamp").on(table.timestamp),
  ],
);

/**
 * What the Plex Watchlist has offered us, and what we did about it.
 *
 * The watchlist itself is not a queue and keeps no record of having been
 * acted on: an item sits there until the user removes it, and the API answers
 * the same way on the thousandth poll as on the first. Without a ledger, a
 * sync that runs every half hour would re-request an item whose *Arr add
 * failed every half hour forever, and an item the user removed and re-added
 * would be requested twice.
 *
 * Keyed on the `plex://` guid rather than the rating key. Both identify the
 * item, but the guid is the one that survives — plex.tv reissues rating keys,
 * and a primary key that changes under a row silently duplicates it.
 *
 * Rows are never deleted when an item leaves the watchlist. "We have already
 * dealt with this" is the whole value of the table, and it has to outlive the
 * entry that prompted it or removing and re-adding becomes a way to request
 * the same film repeatedly.
 */
export const watchlistItems = sqliteTable(
  "watchlist_items",
  {
    /** `plex://movie/5d776b…` */
    guid: text("guid").primaryKey(),
    /**
     * What `removeFromWatchlist` takes. Stored because it is not derivable
     * from the guid, and refreshed on every sighting because plex.tv is free
     * to reissue it — a stale one makes the removal a no-op against somebody
     * else's item at worst and nothing at best.
     */
    ratingKey: text("rating_key").notNull().default(""),
    title: text("title").notNull(),
    /** Plex's own vocabulary: "movie" | "show". Not "tv". */
    type: text("type").notNull(),
    year: integer("year"),
    /** `tmdb:603` / `imdb:tt0133093` / `tvdb:1234`, or "" when Plex gave none. */
    externalId: text("external_id").notNull().default(""),
    /** Plex's `addedAt`, in **seconds** — Plex's unit, as in `media_items`. */
    addedAt: integer("added_at"),
    /** When *we* first saw it, in ms. Distinct from when the user added it. */
    firstSeenAt: integer("first_seen_at").notNull(),
    /**
     * When we last saw it on the watchlist, in ms.
     *
     * This is what separates "still wanted" from "the user changed their
     * mind": an item that has gone from the list must stop being polled for
     * availability, or a request the user withdrew keeps costing an *Arr
     * lookup on every run for as long as the row exists.
     */
    lastSeenAt: integer("last_seen_at").notNull(),
    /** Set when it was pushed to Radarr/Sonarr. Null while it never has been. */
    requestedAt: integer("requested_at"),
    /** new | present | requested | failed | skipped */
    status: text("status").notNull().default("new"),
    /** Why the last attempt failed. Empty otherwise, never null. */
    error: text("error").notNull().default(""),
  },
  (table) => [
    // The two questions the sync asks every run: what still needs acting on,
    // and what has been requested and might have arrived.
    index("idx_watchlist_items_status").on(table.status),
    // The activity table in Settings, newest first.
    index("idx_watchlist_items_first_seen").on(table.firstSeenAt),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// The *Arr mirror
//
// Radarr and Sonarr have no paged library endpoint: `GET /api/v3/movie`
// returns the entire library in one response, tens of megabytes on a large
// install. That single fact is why these tables exist. A unified page across
// four instances cannot be built by proxying — it needs a sort, a filter and a
// page, which means SQL.
//
// What is mirrored is what is durable and queryable. What is volatile —
// the queue, release searches, commands, the *Arr's own health — is proxied
// live on every read, because a stored copy of it is worse than no copy: it
// looks authoritative and is wrong within seconds.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A Radarr movie, as of the last sync.
 *
 * Keyed on `(instanceId, arrId)`. The same film in Radarr-1080p and Radarr-4K
 * is genuinely two rows and must stay that way — collapsing them on `tmdbId`
 * would destroy the comparison that a split-instance setup exists to make, and
 * "which of my two Radarrs has this, and at what quality" is the question the
 * unified page is for.
 */
export const arrMovies = sqliteTable(
  "arr_movies",
  {
    /** Matches `ArrInstance.id` — "radarr" for the default instance. */
    instanceId: text("instance_id").notNull(),
    /** Radarr's own record id. What every mutation endpoint takes. */
    arrId: integer("arr_id").notNull(),
    title: text("title").notNull(),
    sortTitle: text("sort_title").notNull().default(""),
    year: integer("year"),
    /**
     * The join key to `media_items`. Radarr indexes on TMDb, so `tmdbId` is
     * the one that is reliably present; `imdbId` is the fallback for the
     * occasional record TMDb has not matched.
     */
    tmdbId: integer("tmdb_id"),
    imdbId: text("imdb_id"),
    /**
     * The Plex row this resolved to, materialised at sync time.
     *
     * Null is meaningful and is not an error: a movie Radarr has but Plex has
     * never scanned is the single most useful thing reconciliation finds.
     */
    plexRatingKey: text("plex_rating_key"),
    monitored: integer("monitored", { mode: "boolean" }).notNull().default(false),
    hasFile: integer("has_file", { mode: "boolean" }).notNull().default(false),
    /** tba | announced | inCinemas | released | deleted */
    status: text("status").notNull().default(""),
    minimumAvailability: text("minimum_availability").notNull().default(""),
    qualityProfileId: integer("quality_profile_id"),
    rootFolderPath: text("root_folder_path").notNull().default(""),
    path: text("path").notNull().default(""),
    sizeOnDisk: integer("size_on_disk"),
    runtime: integer("runtime"),
    certification: text("certification").notNull().default(""),
    studio: text("studio").notNull().default(""),
    genres: text("genres", { mode: "json" }).$type<string[]>(),
    tags: text("tags", { mode: "json" }).$type<number[]>(),
    /** Quality of the file on disk, where there is one. */
    fileQuality: text("file_quality").notNull().default(""),
    fileCustomFormatScore: integer("file_custom_format_score"),
    /**
     * A poster URL safe to hand the browser.
     *
     * Only ever a provider CDN URL (TMDb/Fanart). Radarr's own
     * `/MediaCover/...` paths need the API key to fetch and must never reach
     * the client — see the image proxy in the server app for those.
     */
    posterUrl: text("poster_url").notNull().default(""),
    addedAt: integer("added_at"),
    inCinemas: integer("in_cinemas"),
    digitalRelease: integer("digital_release"),
    physicalRelease: integer("physical_release"),
    /** The run watermark this row was last seen by. Drives tombstoning. */
    syncedAt: integer("synced_at").notNull(),
    /**
     * Set when a sync completed without seeing this record. Never hard-deleted.
     *
     * Three reasons. A sync that failed halfway must not be able to empty the
     * mirror; `arr_activity` refers to records that may since have gone; and a
     * record that comes back — re-added after a delete — should resurrect its
     * history rather than start over with a new identity.
     */
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    primaryKey({ columns: [table.instanceId, table.arrId] }),
    // The default listing: one instance, still present.
    index("idx_arr_movies_instance_live").on(table.instanceId, table.deletedAt),
    // The Plex join, and cross-instance grouping on the unified page.
    index("idx_arr_movies_tmdb_id").on(table.tmdbId),
    index("idx_arr_movies_imdb_id").on(table.imdbId),
    index("idx_arr_movies_plex_rating_key").on(table.plexRatingKey),
    // "Monitored, no file" — the missing list, per instance.
    index("idx_arr_movies_instance_missing").on(table.instanceId, table.monitored, table.hasFile),
    index("idx_arr_movies_title").on(table.title),
  ],
);

/**
 * A Sonarr series, as of the last sync.
 *
 * Seasons are denormalised onto the row rather than given a table of their
 * own, because a Sonarr season **has no id** — it is a position in an array on
 * the series — and every query that wants seasons wants its series anyway.
 *
 * Episodes are deliberately not mirrored at all. Five hundred shows is fifty
 * thousand episodes, the mirror would need its own incremental strategy, and
 * nothing in the unified pages asks a question at episode granularity. Series
 * detail proxies them live.
 */
export const arrSeries = sqliteTable(
  "arr_series",
  {
    instanceId: text("instance_id").notNull(),
    arrId: integer("arr_id").notNull(),
    title: text("title").notNull(),
    sortTitle: text("sort_title").notNull().default(""),
    year: integer("year"),
    /** Sonarr indexes on TVDb. `tmdbId` exists on newer versions but is not dependable. */
    tvdbId: integer("tvdb_id"),
    imdbId: text("imdb_id"),
    tmdbId: integer("tmdb_id"),
    plexRatingKey: text("plex_rating_key"),
    monitored: integer("monitored", { mode: "boolean" }).notNull().default(false),
    /** continuing | ended | upcoming | deleted */
    status: text("status").notNull().default(""),
    /** standard | daily | anime */
    seriesType: text("series_type").notNull().default(""),
    network: text("network").notNull().default(""),
    seasonFolder: integer("season_folder", { mode: "boolean" }).notNull().default(true),
    qualityProfileId: integer("quality_profile_id"),
    rootFolderPath: text("root_folder_path").notNull().default(""),
    path: text("path").notNull().default(""),
    sizeOnDisk: integer("size_on_disk"),
    runtime: integer("runtime"),
    certification: text("certification").notNull().default(""),
    genres: text("genres", { mode: "json" }).$type<string[]>(),
    tags: text("tags", { mode: "json" }).$type<number[]>(),
    /**
     * Sonarr has no `hasFile`. Presence is "any episode on disk", which these
     * two counts answer — and they also drive the progress bar the library
     * grid shows for a part-complete show.
     */
    episodeCount: integer("episode_count").notNull().default(0),
    episodeFileCount: integer("episode_file_count").notNull().default(0),
    /** `[{ seasonNumber, monitored, episodeCount, episodeFileCount, sizeOnDisk }]` */
    seasons: text("seasons", { mode: "json" }).$type<ArrSeasonShape[]>(),
    posterUrl: text("poster_url").notNull().default(""),
    addedAt: integer("added_at"),
    nextAiringAt: integer("next_airing_at"),
    previousAiringAt: integer("previous_airing_at"),
    syncedAt: integer("synced_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    primaryKey({ columns: [table.instanceId, table.arrId] }),
    index("idx_arr_series_instance_live").on(table.instanceId, table.deletedAt),
    index("idx_arr_series_tvdb_id").on(table.tvdbId),
    index("idx_arr_series_imdb_id").on(table.imdbId),
    index("idx_arr_series_plex_rating_key").on(table.plexRatingKey),
    index("idx_arr_series_instance_missing").on(table.instanceId, table.monitored, table.episodeFileCount),
    index("idx_arr_series_title").on(table.title),
  ],
);

/**
 * What happened to an item, as the *Arr recorded it.
 *
 * Ingested incrementally from `GET /history/since`, append-only, and the one
 * table that makes end-to-end traceability cheap. `downloadId` is the reason
 * it is worth having: it is SABnzbd's `nzo_id` and qBittorrent's torrent hash,
 * so the row that says "grabbed" and the download client's queue entry join
 * without any heuristic at all.
 */
export const arrActivity = sqliteTable(
  "arr_activity",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    instanceId: text("instance_id").notNull(),
    /** radarr | sonarr */
    service: text("service").notNull(),
    /** The *Arr's own history record id. Unique per instance. */
    arrHistoryId: integer("arr_history_id").notNull(),
    /** grabbed | downloadFolderImported | downloadFailed | movieFileDeleted | … */
    eventType: text("event_type").notNull(),
    /** The movie or episode id. */
    arrId: integer("arr_id").notNull().default(0),
    /** The series id for an episode event; 0 for movies. */
    parentArrId: integer("parent_arr_id").notNull().default(0),
    title: text("title").notNull().default(""),
    sourceTitle: text("source_title").notNull().default(""),
    quality: text("quality").notNull().default(""),
    indexer: text("indexer").notNull().default(""),
    /**
     * The download client's own id for this grab — SABnzbd `nzo_id`, or a
     * BitTorrent info hash. **Radarr stores hashes uppercase and qBittorrent
     * reports them lowercase**, so anything joining on this must normalise.
     */
    downloadId: text("download_id").notNull().default(""),
    /** Trimmed: reason, releaseGroup, customFormatScore, importedPath. */
    data: text("data", { mode: "json" }).$type<Record<string, string>>(),
    /** The *Arr's timestamp for the event, in ms. */
    date: integer("date").notNull(),
    syncedAt: integer("synced_at").notNull(),
  },
  (table) => [
    // Re-ingesting an overlapping `since` window must not duplicate rows.
    uniqueIndex("idx_arr_activity_record").on(table.instanceId, table.arrHistoryId),
    // The per-item timeline, newest first.
    index("idx_arr_activity_item").on(table.instanceId, table.arrId, table.date),
    // The download-client join.
    index("idx_arr_activity_download_id").on(table.downloadId),
    // The global feed and the retention sweep.
    index("idx_arr_activity_date").on(table.date),
  ],
);

/**
 * Quality profiles, mirrored.
 *
 * One of only three configuration mirrors, and they are here for the same
 * reason: an add-routing decision, a library filter and a bulk edit all need
 * to name a profile without a network round-trip. Nothing else from the
 * settings areas is mirrored — the rest is read live and snapshotted.
 */
export const arrQualityProfiles = sqliteTable(
  "arr_quality_profiles",
  {
    instanceId: text("instance_id").notNull(),
    arrId: integer("arr_id").notNull(),
    name: text("name").notNull(),
    upgradeAllowed: integer("upgrade_allowed", { mode: "boolean" }).notNull().default(false),
    cutoff: integer("cutoff"),
    syncedAt: integer("synced_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.instanceId, table.arrId] })],
);

export const arrRootFolders = sqliteTable(
  "arr_root_folders",
  {
    instanceId: text("instance_id").notNull(),
    arrId: integer("arr_id").notNull(),
    path: text("path").notNull(),
    accessible: integer("accessible", { mode: "boolean" }).notNull().default(true),
    freeSpace: integer("free_space"),
    syncedAt: integer("synced_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.instanceId, table.arrId] })],
);

export const arrTags = sqliteTable(
  "arr_tags",
  {
    instanceId: text("instance_id").notNull(),
    arrId: integer("arr_id").notNull(),
    label: text("label").notNull(),
    syncedAt: integer("synced_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.instanceId, table.arrId] })],
);

/**
 * Per-instance sync bookkeeping, and the cheap answers.
 *
 * The counts here are what the nav badge and the instance cards read. They are
 * stored rather than computed on demand because the alternative is fanning out
 * to every configured *Arr on every page load, which is exactly the behaviour
 * that makes a dashboard feel broken when one instance is down.
 */
export const arrSyncState = sqliteTable("arr_sync_state", {
  instanceId: text("instance_id").primaryKey(),
  service: text("service").notNull(),
  /** As reported by `/system/status`. Gates which settings areas are offered. */
  arrVersion: text("arr_version").notNull().default(""),
  /** Derived from the version once per sync. Branch on this, never on service. */
  capabilities: text("capabilities", { mode: "json" }).$type<string[]>(),
  lastFullSyncAt: integer("last_full_sync_at"),
  lastIncrementalAt: integer("last_incremental_at"),
  /** Newest `arr_activity.date` consumed, so `/history/since` can resume. */
  historyWatermark: integer("history_watermark").notNull().default(0),
  itemCount: integer("item_count").notNull().default(0),
  queueCount: integer("queue_count").notNull().default(0),
  diskFree: integer("disk_free"),
  /** Empty when the last run succeeded, never null. */
  lastError: text("last_error").notNull().default(""),
  lastErrorAt: integer("last_error_at"),
});
