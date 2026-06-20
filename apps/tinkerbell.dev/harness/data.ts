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
  type: string;
  enabled: boolean;
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
    labels: ["Tinkerbell", "Sci-Fi"],
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
    labels: ["Tinkerbell"],
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
    labels: ["Tinkerbell", "Mood"],
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
    labels: ["Tinkerbell", "4K"],
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
    labels: ["Tinkerbell", "Drama"],
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
    labels: ["Tinkerbell", "Requests"],
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
    labels: ["Tinkerbell", "Mood"],
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
    labels: ["Tinkerbell"],
    itemRatingKeys: movieKeys.slice(5, 11),
    hue: 12,
  },
];

export const RULES: DemoRule[] = [
  {
    id: "rule-top-scifi",
    name: "Top Rated · Sci-Fi",
    type: "smart-filter",
    enabled: true,
    collectionCount: 1,
    itemCount: 42,
    status: "ok",
  },
  {
    id: "rule-recent",
    name: "Recently Added (per section)",
    type: "recently-added",
    enabled: true,
    collectionCount: 2,
    itemCount: 88,
    status: "ok",
  },
  {
    id: "rule-cozy",
    name: "Cozy Autumn Nights",
    type: "ai-prompt",
    enabled: true,
    collectionCount: 1,
    itemCount: 24,
    status: "ok",
  },
  {
    id: "rule-4k",
    name: "4K Showcase",
    type: "smart-filter",
    enabled: true,
    collectionCount: 1,
    itemCount: 31,
    status: "ok",
  },
  {
    id: "rule-requests",
    name: "From Your Requests",
    type: "overseerr",
    enabled: true,
    collectionCount: 1,
    itemCount: 57,
    status: "ok",
  },
  {
    id: "rule-imdb-top",
    name: "IMDb Top 250 (owned)",
    type: "imdb-chart",
    enabled: false,
    collectionCount: 1,
    itemCount: 73,
    status: "ok",
  },
  {
    id: "rule-byw",
    name: "Because You Watched",
    type: "because-you-watched",
    enabled: true,
    collectionCount: 6,
    itemCount: 120,
    status: "ok",
  },
  {
    id: "rule-gems",
    name: "Hidden Gems",
    type: "smart-filter",
    enabled: true,
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
