/**
 * Single source of truth for marketing copy. Feature entries reference a
 * screenshot by `shot`, whose filename lives under /public/screenshots and is
 * produced by the capture harness (harness/shots.ts carries the same slug in
 * its `site` field).
 *
 * The feature list tracks the app, not a pitch: when a page lands in the admin
 * sidebar (`apps/web/src/nav.ts`) it belongs here too.
 *
 * The copy is plain on purpose. Say what the thing does, with real nouns and
 * numbers. No slogans or taglines, and no dashes used as asides. The site
 * once had a slogan on every card, and it read like generated filler.
 */

export interface Shot {
  /** Slug: matches the harness shot's `site` field and the /screenshots/<slug>.png file. */
  slug: string;
  /** Path shown in the browser frame's address bar. */
  path: string;
  title: string;
  caption: string;
}

export type FeatureGroupId = "curate" | "manage" | "operate";

export interface FeatureGroup {
  id: FeatureGroupId;
  title: string;
}

export interface Feature {
  id: string;
  group: FeatureGroupId;
  title: string;
  /** A short fact, set in mono beside the title. Only where there's a number or a name worth stating. */
  stat?: string;
  /** One sentence for the home page list. */
  summary: string;
  /** The full description on the Features page. */
  body: string;
  /** Slug of the screenshot that illustrates this feature (optional). */
  shot?: string;
}

export const GITHUB_URL = "https://github.com/sdgluck/tinkerbell";

export const SHOTS: Shot[] = [
  { slug: "collections", path: "collections", title: "Collections", caption: "Collections in grid view." },
  { slug: "overlays", path: "overlays", title: "Overlays", caption: "The overlay editor." },
  {
    slug: "rules",
    path: "rules",
    title: "Rules",
    caption: "Every rule with its type, schedule and last run.",
  },
  {
    slug: "preview",
    path: "preview",
    title: "Preview",
    caption: "One user's Plex home screen, as Tinkerbell sets it up.",
  },
  { slug: "media", path: "media", title: "Media", caption: "Every item with its resolution, codecs and audio." },
  { slug: "users", path: "users", title: "Users", caption: "Shared users and whether they use personalization." },
  { slug: "stats", path: "stats", title: "Stats", caption: "Streams, health and library stats." },
  { slug: "jobs", path: "jobs", title: "Jobs", caption: "Every job, its schedule and its last run." },
  { slug: "schedule", path: "jobs/schedule", title: "Schedule", caption: "The day's jobs on a timeline." },
  { slug: "events", path: "events", title: "Events", caption: "What Tinkerbell has done, newest first." },
];

export const SHOTS_BY_SLUG: Record<string, Shot> = Object.fromEntries(SHOTS.map((s) => [s.slug, s]));

export const FEATURE_GROUPS: FeatureGroup[] = [
  { id: "curate", title: "Library" },
  { id: "manage", title: "Servers and users" },
  { id: "operate", title: "Running it" },
];

export const FEATURES: Feature[] = [
  // ── Library ─────────────────────────────────────────────────────────────
  {
    id: "rules",
    group: "curate",
    title: "Rules",
    stat: "29 types",
    summary: "Turn your library into collections, playlists or metadata edits.",
    body: "Top and lowest rated, actors, directors, studios, networks, genres, countries, decades, years, resolutions, audio and subtitle languages, awards, streaming services, seasonal, IMDb charts and lists, MDBList and Trakt lists, TMDb franchises and Overseerr requests. Each rule can run on its own schedule. Every run is logged, and any edit to a rule can be undone.",
    shot: "rules",
  },
  {
    id: "smart-filters",
    group: "curate",
    title: "Smart filters and AI",
    stat: "4 AI providers",
    summary: "Build a filter from clauses, or describe it and let AI write the clauses.",
    body: 'Smart filters nest AND/OR clauses over Plex metadata, IMDb and OMDb ratings, labels and Overseerr requests. You can also describe a filter in words, like "gritty 90s neo-noir", and edit what comes back. Works with Anthropic, OpenAI, Gemini or a local Ollama. Token use is counted per feature and model, and an optional monthly budget pauses AI features when it runs out.',
  },
  {
    id: "collections",
    group: "curate",
    title: "Collections",
    summary: "Posters, summaries, sort order and pins on the Plex home screen.",
    body: "Each collection gets a generated poster and summary, a sort order, and can be pinned to the Plex home screen. Grouped rules can rotate which of their collections are pinned, and shuffled hubs change order on a schedule.",
    shot: "collections",
  },
  {
    id: "overlays",
    group: "curate",
    title: "Overlays",
    summary: "Draw ratings, resolution and other badges onto posters.",
    body: "Place badges on a poster in the editor, save the layout as a preset, and preview a whole library before applying it. A separate job takes them off again.",
    shot: "overlays",
  },
  {
    id: "personalized",
    group: "curate",
    title: "Personalized home screens",
    summary: "Each user gets Because You Watched rows and collections only they can see.",
    body: "Users sign in to a separate portal with their Plex account. There they mark genres they love, like or avoid, hide titles with Not for me, and see what is leaving soon. Turning the feature off restores everyone's previous sharing settings.",
    shot: "preview",
  },
  {
    id: "prerolls",
    group: "curate",
    title: "Prerolls",
    stat: "Plex Pass",
    summary: "Videos for Plex to play before a movie.",
    body: "Upload a video or import one from a URL. Anything Plex can't play directly is converted to H.264. Tinkerbell can also make a preroll that shows viewers the portal's address, with a QR code.",
  },

  // ── Servers and users ───────────────────────────────────────────────────
  {
    id: "cleanup",
    group: "manage",
    title: "Cleanup",
    stat: "dry-run first",
    summary: "Label, unmonitor or delete what nobody watches, or move it to Leaving Soon.",
    body: "Pick what to retire with the same filters as any rule. Label it, move it to Leaving Soon, unmonitor it or delete it through Radarr and Sonarr. Rules start in dry-run. An item has to match several runs in a row before anything happens, and you can require approval for each one. Protected items are never touched.",
  },
  {
    id: "arr",
    group: "manage",
    title: "Radarr and Sonarr",
    summary: "Every Radarr and Sonarr instance in one table.",
    body: "Monitor, search, pick a release or remove a title without opening Radarr or Sonarr. Split setups, such as a 1080p and a 4K Radarr, show together. A health page lists files Radarr has that Plex never scanned, and grabs that never imported. Quality profiles can be managed from presets based on TRaSH Guides, and a nightly check reports any drift.",
  },
  {
    id: "downloads",
    group: "manage",
    title: "Downloads",
    stat: "5 clients",
    summary: "SABnzbd, NZBGet, qBittorrent, Transmission and Deluge next to the Radarr and Sonarr queue.",
    body: "Each client's real state sits beside the Radarr and Sonarr queue. Pause or resume a client or a single item. When an import is blocked, you see the actual error.",
  },
  {
    id: "discover",
    group: "manage",
    title: "Discover and watchlist",
    summary: "Search TMDb, see what you already have, and send the rest to Radarr or Sonarr.",
    body: "Results show whether Plex or Radarr and Sonarr already have each title. Send new ones with the instance, quality profile and root folder you choose. Search MDBList and Trakt lists and make a rule from one. Titles added to a Plex watchlist are requested automatically.",
  },
  {
    id: "users",
    group: "manage",
    title: "Users",
    summary: "Invite people, choose their libraries, and see what they are watching.",
    body: "Invite users, choose which libraries they can see, set limits, and see or stop what they are streaming. Each user has a page with their playback history.",
    shot: "users",
  },
  {
    id: "library",
    group: "manage",
    title: "Media, duplicates and labels",
    summary: "Filter the library by resolution, codec, audio and label.",
    body: "Filter the whole library by resolution, codec, audio, label and more, then turn the filter into a rule. Find titles with several versions, or one film matched twice. Apply or remove labels in bulk after a preview. Metadata edits are stored and re-applied.",
    shot: "media",
  },

  // ── Running it ──────────────────────────────────────────────────────────
  {
    id: "jobs",
    group: "operate",
    title: "Jobs and schedules",
    summary: "Every sync and rule is a job with a schedule and a log.",
    body: "Each job has a schedule, a run history and a live log with progress. The schedule page shows a day or a week as a timeline you can drag jobs around on. Missed runs catch up when Tinkerbell starts, and long jobs resume after a restart.",
    shot: "jobs",
  },
  {
    id: "stats",
    group: "operate",
    title: "Stats and activity",
    summary: "Streams, bandwidth, most watched, and a log of what Tinkerbell changed.",
    body: "A dashboard of active streams, bandwidth, recently added, most watched and library size, with the tiles you choose. The Events page logs what Tinkerbell did, and the Changes page lists every change it made to Plex.",
    shot: "stats",
  },
  {
    id: "notifications",
    group: "operate",
    title: "Notifications and digests",
    stat: "9 services",
    summary: "Discord, Slack, Telegram, email and five more.",
    body: "Discord, Slack, Telegram, Gotify, Pushbullet, Pushover, LunaSea, email and webhooks. Choose which events go to which service. A scheduled digest lists what was added to the library and what is leaving.",
  },
  {
    id: "stress-test",
    group: "operate",
    title: "Stress test",
    stat: "up to 50 streams",
    summary: "Finds how many streams your server can handle.",
    body: "Starts real transcode, direct-play or mixed streams one at a time until the server can't keep up. Speed and bandwidth are charted live. Test plays are kept out of your stats and watch history, and past runs can be replayed.",
  },
  {
    id: "backup",
    group: "operate",
    title: "Backups, export and history",
    stat: "180 days",
    summary: "Nightly backups, export and import, and undo for every setting.",
    body: "The database is backed up every night and the last 7 copies are kept. Rules, schedules, presets and settings export to one file that another Tinkerbell can import, with a preview first. Every change to a rule, setting, job, preset or preroll is logged with who made it, and can be restored for 180 days.",
  },
  {
    id: "api",
    group: "operate",
    title: "MCP server and API",
    stat: "read-only",
    summary: "Let Claude and other AI clients look up anything in Tinkerbell.",
    body: "An MCP server and a JSON API answer questions like why a film isn't in a collection, or what last night's run changed. Every request needs an API key, and nothing can be changed through either.",
  },
  {
    id: "migrate",
    group: "operate",
    title: "Import from Kometa",
    summary: "Bring an existing Kometa config with you.",
    body: "Collections that Tinkerbell has a rule type for become rules. The rest are kept as static lists, so they stay in Plex.",
  },
];

export const FEATURES_BY_GROUP: Record<FeatureGroupId, Feature[]> = {
  curate: FEATURES.filter((f) => f.group === "curate"),
  manage: FEATURES.filter((f) => f.group === "manage"),
  operate: FEATURES.filter((f) => f.group === "operate"),
};

export const INSTALL_FACTS = [
  "One container, SQLite, amd64 and arm64.",
  "Admin app on port 3000, user portal on 3100.",
  "Optional Plex sign-in for the admin app.",
  "An Unraid template is in the repo.",
];
