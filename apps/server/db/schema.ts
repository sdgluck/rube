import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

export const config = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value"),
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
    labels: text("labels").notNull().default("[]"),
    addedAt: integer("added_at"),
    thumb: text("thumb").notNull().default(""),
    smart: integer("smart").notNull().default(0),
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
  config: text("config").notNull().default("{}"),
});

export const rules = sqliteTable("rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  enabled: integer("enabled").notNull().default(1),
  config: text("config").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
  lastCollectionRatingKey: text("last_collection_rating_key"),
});

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
    id: text("id").primaryKey(), // "{sectionId}:{position}"
    sectionId: text("section_id").notNull(),
    position: text("position").notNull(),
    overlayType: text("overlay_type").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_overlay_configs_section").on(table.sectionId)],
);

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
    metadata: text("metadata"),
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
  data: text("data").notNull(),
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
  config: text("config").notNull(),
  maxSessions: integer("max_sessions"),
  steps: text("steps").notNull().default("[]"),
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
  response: text("response").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});
