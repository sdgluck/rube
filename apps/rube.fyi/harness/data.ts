/**
 * Synthetic demo dataset shared by the seed (writes the DB) and the mock Plex
 * server (resolves a rating key back to a title so it can render the matching
 * poster). Everything here is invented — no real titles, no real people, no
 * copyrighted art — because the captures ship on a public website.
 *
 * Rating-key convention: a thumb path is `/library/metadata/<ratingKey>/thumb/1`.
 * The mock parses <ratingKey> out of any image request and looks the item up in
 * ITEM_BY_RATING_KEY to pick the poster title + accent.
 */

export interface DemoSection {
  key: string;
  title: string;
  type: "movie" | "show";
}

export interface DemoItem {
  ratingKey: string;
  sectionId: string;
  sectionTitle: string;
  title: string;
  year: number;
  type: "movie" | "show";
  videoResolution: "4k" | "1080" | "720";
  videoCodec: "hevc" | "h264";
  audioCodec: "truehd" | "eac3" | "aac";
  audioChannels: number;
  container: "mkv" | "mp4";
  /** Accent hue (0–360) used by the poster generator for a stable look. */
  hue: number;
}

export interface DemoCollection {
  ratingKey: string;
  sectionId: string;
  sectionTitle: string;
  title: string;
  summary: string;
  smart: boolean;
  labels: string[];
  itemRatingKeys: string[];
  hue: number;
}

export interface DemoRule {
  id: string;
  name: string;
  /**
   * Must be a real value from `RULE_TYPES` in the wizard's rule-types.ts —
   * the list page keys its labels, badge colours and config summary off it, and
   * an invented id falls through to showing the raw string.
   */
  type: string;
  enabled: boolean;
  /** Shape must match `CONFIG_SUMMARY[type]`, which renders the config column. */
  config: Record<string, unknown>;
  collectionCount: number;
  itemCount: number;
  status: "ok" | "error";
}

export const SECTIONS: DemoSection[] = [
  { key: "1", title: "Movies", type: "movie" },
  { key: "2", title: "TV Shows", type: "show" },
];

const MOVIE_TITLES: Array<[string, number, number]> = [
  ["Neon Cartographer", 2021, 268],
  ["The Salt Horizon", 2019, 198],
  ["Paper Lighthouse", 2023, 28],
  ["Velvet Static", 2018, 322],
  ["Hollow Mercury", 2022, 12],
  ["The Glass Orchard", 2020, 150],
  ["Midnight Cartography", 2024, 210],
  ["Ashfall Mondays", 2017, 38],
  ["The Quiet Antenna", 2021, 250],
  ["Cobalt Pilgrim", 2016, 230],
  ["Lantern of Tides", 2023, 90],
  ["The Paper Comet", 2019, 340],
];

const SHOW_TITLES: Array<[string, number, number]> = [
  ["Driftwood County", 2022, 175],
  ["The Tinkers' Guild", 2020, 45],
  ["Harbor & Vale", 2023, 290],
  ["Echo Meridian", 2019, 130],
  ["Sablewood", 2021, 8],
  ["The Lamplight Office", 2024, 60],
  ["Gossamer Lines", 2018, 305],
  ["Northwind Academy", 2022, 110],
];

const RES: DemoItem["videoResolution"][] = ["4k", "1080", "1080", "720"];
const VCODEC: DemoItem["videoCodec"][] = ["hevc", "h264"];
const ACODEC: DemoItem["audioCodec"][] = ["truehd", "eac3", "aac"];
const ACH = [8, 6, 6, 2];
const CONT: DemoItem["container"][] = ["mkv", "mp4"];

function buildItems(): DemoItem[] {
  const items: DemoItem[] = [];
  let n = 1000;
  for (const [title, year, hue] of MOVIE_TITLES) {
    const i = items.length;
    items.push({
      ratingKey: String(n++),
      sectionId: "1",
      sectionTitle: "Movies",
      title,
      year,
      type: "movie",
      videoResolution: RES[i % RES.length],
      videoCodec: VCODEC[i % VCODEC.length],
      audioCodec: ACODEC[i % ACODEC.length],
      audioChannels: ACH[i % ACH.length],
      container: CONT[i % CONT.length],
      hue,
    });
  }
  for (const [title, year, hue] of SHOW_TITLES) {
    const i = items.length;
    items.push({
      ratingKey: String(n++),
      sectionId: "2",
      sectionTitle: "TV Shows",
      title,
      year,
      type: "show",
      videoResolution: RES[i % RES.length],
      videoCodec: VCODEC[i % VCODEC.length],
      audioCodec: ACODEC[i % ACODEC.length],
      audioChannels: ACH[i % ACH.length],
      container: CONT[i % CONT.length],
      hue,
    });
  }
  return items;
}

export const ITEMS: DemoItem[] = buildItems();

const movieKeys = ITEMS.filter((i) => i.type === "movie").map((i) => i.ratingKey);
const showKeys = ITEMS.filter((i) => i.type === "show").map((i) => i.ratingKey);

export const COLLECTIONS: DemoCollection[] = [
  {
    ratingKey: "5001",
    sectionId: "1",
    sectionTitle: "Movies",
    title: "Top Rated · Sci-Fi",
    summary: "Highest-rated science fiction, refreshed weekly from IMDb ratings.",
    smart: true,
    labels: ["Rube", "Sci-Fi"],
    itemRatingKeys: movieKeys.slice(0, 6),
    hue: 268,
  },
  {
    ratingKey: "5002",
    sectionId: "1",
    sectionTitle: "Movies",
    title: "Recently Added",
    summary: "Everything added to the Movies library in the last 30 days.",
    smart: true,
    labels: ["Rube"],
    itemRatingKeys: movieKeys.slice(2, 9),
    hue: 200,
  },
  {
    ratingKey: "5003",
    sectionId: "1",
    sectionTitle: "Movies",
    title: "Cozy Autumn Nights",
    summary: "An AI-generated mood collection — warm, slow, atmospheric.",
    smart: false,
    labels: ["Rube", "Mood"],
    itemRatingKeys: movieKeys.slice(4, 10),
    hue: 28,
  },
  {
    ratingKey: "5004",
    sectionId: "1",
    sectionTitle: "Movies",
    title: "4K Showcase",
    summary: "Direct-play 4K HDR titles for the big screen.",
    smart: true,
    labels: ["Rube", "4K"],
    itemRatingKeys: movieKeys.slice(0, 5),
    hue: 150,
  },
  {
    ratingKey: "5005",
    sectionId: "2",
    sectionTitle: "TV Shows",
    title: "Bingeable Dramas",
    summary: "Long-running drama series with at least three seasons.",
    smart: true,
    labels: ["Rube", "Drama"],
    itemRatingKeys: showKeys.slice(0, 5),
    hue: 322,
  },
  {
    ratingKey: "5006",
    sectionId: "2",
    sectionTitle: "TV Shows",
    title: "From Your Requests",
    summary: "Shows fulfilled from Overseerr requests in the past quarter.",
    smart: true,
    labels: ["Rube", "Requests"],
    itemRatingKeys: showKeys.slice(2, 8),
    hue: 90,
  },
  {
    ratingKey: "5007",
    sectionId: "2",
    sectionTitle: "TV Shows",
    title: "Comfort Rewatches",
    summary: "Hand-picked shows for a low-stakes evening.",
    smart: false,
    labels: ["Rube", "Mood"],
    itemRatingKeys: showKeys.slice(1, 6),
    hue: 45,
  },
  {
    ratingKey: "5008",
    sectionId: "1",
    sectionTitle: "Movies",
    title: "Hidden Gems",
    summary: "Well-reviewed films with fewer than 50k votes.",
    smart: true,
    labels: ["Rube"],
    itemRatingKeys: movieKeys.slice(5, 11),
    hue: 12,
  },
];

export const RULES: DemoRule[] = [
  {
    id: "rule-top-scifi",
    name: "Top Rated · Sci-Fi",
    type: "smart_filter",
    enabled: true,
    config: {
      filters: [
        { field: "genre", op: "=", value: "Science Fiction" },
        { field: "year", op: ">>=", value: "2015" },
      ],
    },
    collectionCount: 1,
    itemCount: 42,
    status: "ok",
  },
  {
    id: "rule-highest",
    name: "Highest Rated",
    type: "top_rated",
    enabled: true,
    config: { limit: 50 },
    collectionCount: 2,
    itemCount: 88,
    status: "ok",
  },
  {
    id: "rule-cozy",
    name: "Cozy Autumn Nights",
    type: "ai_prompt",
    enabled: true,
    config: { themes: ["cosy", "autumnal", "slow-burn"], limit: 10, minItems: 12 },
    collectionCount: 1,
    itemCount: 24,
    status: "ok",
  },
  {
    id: "rule-4k",
    name: "4K Showcase",
    type: "smart_filter",
    enabled: true,
    config: { filters: [{ field: "resolution", op: "=", value: "4k" }] },
    collectionCount: 1,
    itemCount: 31,
    status: "ok",
  },
  {
    id: "rule-requests",
    name: "From Your Requests",
    type: "seerr_requests",
    enabled: true,
    config: { filter: "available", limit: 40 },
    collectionCount: 1,
    itemCount: 57,
    status: "ok",
  },
  {
    id: "rule-imdb-top",
    name: "IMDb Top 250 (owned)",
    type: "imdb_chart",
    enabled: false,
    config: { chart: "top" },
    collectionCount: 1,
    itemCount: 73,
    status: "ok",
  },
  {
    id: "rule-studios",
    name: "By Studio",
    type: "studios",
    enabled: true,
    config: {},
    collectionCount: 6,
    itemCount: 120,
    status: "ok",
  },
  {
    id: "rule-gems",
    name: "Hidden Gems",
    type: "smart_filter",
    enabled: true,
    config: {
      filters: [
        { field: "rating", op: ">>=", value: "7.5" },
        { field: "audienceRating", op: "<<=", value: "8.5" },
      ],
    },
    collectionCount: 1,
    itemCount: 29,
    status: "error",
  },
];

export const USERS: Array<{
  userId: number;
  username: string;
  name: string;
  collectionCount: number;
  lastWatched: string;
  agoMin: number;
}> = [
  {
    userId: 101,
    username: "ava.tinker",
    name: "Ava",
    collectionCount: 6,
    lastWatched: "Neon Cartographer",
    agoMin: 35,
  },
  { userId: 102, username: "miloh", name: "Milo", collectionCount: 6, lastWatched: "Driftwood County", agoMin: 220 },
  { userId: 103, username: "rune_w", name: "Rune", collectionCount: 6, lastWatched: "The Salt Horizon", agoMin: 1500 },
  { userId: 104, username: "sol.vega", name: "Sol", collectionCount: 6, lastWatched: "Echo Meridian", agoMin: 60 },
  { userId: 105, username: "io.bask", name: "Io", collectionCount: 6, lastWatched: "Cobalt Pilgrim", agoMin: 4300 },
];

export const EVENTS: Array<{ type: string; message: string; agoMin: number }> = [
  { type: "job.completed", message: "sync-media finished — 312 items in 4.2s", agoMin: 3 },
  { type: "rule.run", message: "Top Rated · Sci-Fi produced 1 collection (42 items)", agoMin: 9 },
  { type: "job.completed", message: "generate finished — 8 collections refreshed", agoMin: 21 },
  { type: "overlay.applied", message: "Applied rating overlays to 128 posters in Movies", agoMin: 44 },
  { type: "rule.run", message: "Because You Watched produced 6 collections (120 items)", agoMin: 70 },
  { type: "health.ok", message: "Plex health check passed (1080 items reachable)", agoMin: 95 },
  { type: "job.completed", message: "sync-collections finished — 8 collections in 1.1s", agoMin: 130 },
  { type: "rule.error", message: "Hidden Gems failed — OMDb rate limit, will retry", agoMin: 180 },
  // Pairs with `run-healthcheck-fail` in JOB_RUNS, at the same age. Every real
  // failure path emits this event, so a fixture with the failed run and no
  // event is a state the app cannot actually produce — and it makes the Failed
  // Jobs tile, which links to exactly this filter, appear to lead nowhere.
  { type: "job.failed", message: "Healthcheck failed: OMDb: request timed out", agoMin: 95 },
];

/** rating key → poster title + hue, for the mock Plex image endpoint. */
export const ITEM_BY_RATING_KEY: Record<string, { title: string; hue: number; kind: "item" | "collection" }> =
  Object.fromEntries([
    ...ITEMS.map((i) => [i.ratingKey, { title: i.title, hue: i.hue, kind: "item" as const }]),
    ...COLLECTIONS.map((c) => [c.ratingKey, { title: c.title, hue: c.hue, kind: "collection" as const }]),
  ]);

/** Build the thumb path the app stores and the mock later resolves. */
export function thumbPath(ratingKey: string): string {
  return `/library/metadata/${ratingKey}/thumb/1`;
}

// ─── Prerolls ────────────────────────────────────────────────────────────────
//
// One of each card state, so the page shows the ready / processing / failed
// treatments side by side rather than three identical rows.

export interface DemoPreroll {
  id: string;
  name: string;
  status: "ready" | "processing" | "failed";
  enabled: boolean;
  position: number;
  sizeBytes: number;
  durationMs: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
  transcodeAction: string;
  transcodeReasons: string[];
  error: string;
}

export const PREROLLS: DemoPreroll[] = [
  {
    id: "pr-001",
    name: "Feature Presentation",
    status: "ready",
    enabled: true,
    position: 1,
    sizeBytes: 18_432_000,
    durationMs: 12_400,
    width: 1920,
    height: 1080,
    videoCodec: "h264",
    audioCodec: "aac",
    transcodeAction: "copy",
    transcodeReasons: ["Plex direct plays this already"],
    error: "",
  },
  {
    id: "pr-002",
    name: "Cinema Ident",
    status: "ready",
    enabled: true,
    position: 2,
    sizeBytes: 7_340_032,
    durationMs: 6_000,
    width: 3840,
    height: 2160,
    videoCodec: "h264",
    audioCodec: "aac",
    transcodeAction: "encode",
    transcodeReasons: ["Source was HEVC 10-bit", "Normalised to H.264/AAC"],
    error: "",
  },
  {
    id: "pr-003",
    name: "Late Night Sting",
    status: "processing",
    enabled: true,
    position: 3,
    sizeBytes: 24_117_248,
    durationMs: 0,
    width: 0,
    height: 0,
    videoCodec: "",
    audioCodec: "",
    transcodeAction: "",
    transcodeReasons: [],
    error: "",
  },
  {
    id: "pr-004",
    name: "Old Projector Reel",
    status: "failed",
    enabled: false,
    position: 4,
    sizeBytes: 3_145_728,
    durationMs: 0,
    width: 0,
    height: 0,
    videoCodec: "",
    audioCodec: "",
    transcodeAction: "",
    transcodeReasons: [],
    error: "ffmpeg: moov atom not found — the upload is truncated",
  },
];

// ─── Job runs ────────────────────────────────────────────────────────────────
//
// The job rows themselves are created by the server at boot (`seedDefaultJobs`),
// so these only supply history. Ids are fixed because shots.ts links straight
// to `/jobs/runs/<id>`.

export interface DemoJobRun {
  id: string;
  jobId: string;
  status: "completed" | "failed" | "running";
  message: string;
  progress: number;
  agoMin: number;
  durationMs: number;
  log: string;
}

export const JOB_RUNS: DemoJobRun[] = [
  {
    id: "run-generate-1",
    jobId: "generate",
    status: "completed",
    message: "8 collections refreshed",
    progress: 1,
    agoMin: 21,
    durationMs: 4_180,
    log: [
      "[12:00:01] starting generate",
      "[12:00:01] 8 enabled rules",
      "[12:00:02] Top Rated · Sci-Fi → 42 items",
      "[12:00:02] Recently Added (per section) → 88 items",
      "[12:00:03] Cozy Autumn Nights → 24 items",
      "[12:00:03] 4K Showcase → 31 items",
      "[12:00:04] From Your Requests → 57 items",
      "[12:00:04] Because You Watched → 120 items across 6 collections",
      "[12:00:05] Hidden Gems → OMDb rate limit exceeded (429), skipped",
      "[12:00:05] done — 8 collections, 362 items, 4.18s",
    ].join("\n"),
  },
  {
    id: "run-generate-2",
    jobId: "generate",
    status: "completed",
    message: "8 collections refreshed",
    progress: 1,
    agoMin: 1_461,
    durationMs: 3_920,
    log: "[12:00:01] starting generate\n[12:00:05] done — 8 collections, 358 items, 3.92s",
  },
  {
    id: "run-sync-media-1",
    jobId: "sync-media",
    status: "completed",
    message: "312 items in 4.2s",
    progress: 1,
    agoMin: 3,
    durationMs: 4_210,
    log: "[12:00:00] syncing Movies\n[12:00:02] syncing TV Shows\n[12:00:04] done — 312 items",
  },
  {
    id: "run-purge-1",
    jobId: "purge-runs",
    status: "completed",
    message: "42 runs removed",
    progress: 1,
    agoMin: 190,
    durationMs: 210,
    log: "[12:00:00] retention 30 days\n[12:00:00] removed 42 runs",
  },
  {
    id: "run-healthcheck-fail",
    jobId: "healthcheck",
    status: "failed",
    message: "OMDb: request timed out",
    progress: 1,
    agoMin: 95,
    durationMs: 30_120,
    log: "[12:00:00] checking 6 services\n[12:00:30] OMDb: The operation was aborted due to timeout",
  },
];

// ─── Health ──────────────────────────────────────────────────────────────────
// Mixed on purpose: the sidebar footer and the Health page both want to show
// something other than "all green".

export const HEALTH: Array<{ service: string; status: "ok" | "error"; message: string; agoMin: number }> = [
  { service: "Plex", status: "ok", message: "Reachable — 20 items across 2 libraries", agoMin: 2 },
  { service: "Plex.tv", status: "ok", message: "Signed in", agoMin: 2 },
  { service: "Radarr", status: "ok", message: "v5.14 — 2 root folders", agoMin: 4 },
  { service: "Sonarr", status: "ok", message: "v4.0 — 1 root folder", agoMin: 4 },
  { service: "OMDb", status: "error", message: "The operation was aborted due to timeout", agoMin: 6 },
  { service: "TMDb", status: "ok", message: "Authenticated", agoMin: 6 },
];

/**
 * Integration config, so the Settings tabs show a filled-in form rather than an
 * empty one. Hostnames are `.demo`, which is not a resolvable TLD — a probe
 * against these can only ever fail locally, never reach anything real.
 */
export const SERVICE_CONFIG = {
  global_radarr_url: "http://radarr.demo:7878",
  global_sonarr_url: "http://sonarr.demo:8989",
  global_seerr_url: "http://seerr.demo:5055",
} as const;

/**
 * No API keys, tokens or webhook URLs here, deliberately. The server never
 * ships a secret to the browser — it substitutes `__redacted__:<uuid>`, and
 * that uuid is randomised per process on purpose, so a screenshot of a
 * filled-in secret field would differ on every single capture. Empty secret
 * fields are also the honest thing to publish.
 */
export const LLM_CONFIG = {
  provider: "anthropic",
  model: "claude-sonnet-5",
} as const;
