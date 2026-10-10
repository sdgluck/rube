/**
 * How each job id is presented: which list it belongs in, whether its
 * schedule is worth editing, what it does, and where its related settings live.
 *
 * One table for both sides. The web used to keep this in `fields.ts`, which
 * classified any id it didn't list as an installable *feature* — so Cleanup,
 * Metadata, Backup and five others sat under "Your Features" with a Remove
 * button that could only throw. Unknown ids now fall back to `system`, and the
 * job registry drift tests fail on any id missing from here.
 */

export type JobKind = "system" | "feature" | "hidden";

/**
 * The sections of System Tasks, in display order. Twenty-four tasks in one
 * alphabetical list put "Back Up Database" between two metadata jobs and made
 * a failure one row among many; grouped by what they look after, a healthy
 * group collapses to one line and a failing one is the thing you see.
 *
 * `background` is everything that runs every few seconds to minutes — pollers
 * and watchers. They are plumbing, they are almost always fine, and they made
 * up a third of the list.
 */
export const SYSTEM_GROUPS = [
  { id: "library", label: "Library sync" },
  { id: "automation", label: "Automation" },
  { id: "maintenance", label: "Maintenance" },
  { id: "background", label: "Background" },
] as const;
export type SystemGroup = (typeof SYSTEM_GROUPS)[number]["id"];

export interface JobPresentation {
  /**
   * - `system` — always installed; listed under System Tasks.
   * - `feature` — opt-in; installed from the wizard and removable.
   * - `hidden` — one-shot actions driven from another page; reachable by URL.
   */
  kind: JobKind;
  /** System tasks only: which System Tasks section it is listed under. */
  group?: SystemGroup;
  /** `hidden` when the schedule has no meaning (a one-shot import). */
  schedule?: "editable" | "hidden";
  description: string;
  /** Where the switches this job obeys are set, when that isn't the job page. */
  settingsHref?: string;
  settingsLabel?: string;
  /** Features only: what to set up first, in a sentence, for the install wizard. */
  requires?: string;
}

/** The opt-in jobs, in the order the wizard offers them. */
export const FEATURE_IDS = [
  "because-you-watched",
  "we-think-youd-like",
  "personalize",
  "shuffle",
  "overlays",
  "digest",
] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];

export function isFeatureId(id: string): id is FeatureId {
  return (FEATURE_IDS as readonly string[]).includes(id);
}

export const JOB_PRESENTATION: Record<string, JobPresentation> = {
  // ── System ──────────────────────────────────────────────────────────────
  "sync-media": {
    kind: "system",
    group: "library",
    description: "Pulls movies and shows from Plex into the local database so other jobs can act on them.",
  },
  "sync-collections": {
    kind: "system",
    group: "library",
    description: "Mirrors existing Plex collections into the database and keeps their items in sync.",
  },
  "sync-arr": {
    kind: "system",
    group: "library",
    description: "Pulls movies and series from Radarr and Sonarr and links them to the matching Plex items.",
    settingsHref: "/settings/arrs",
    settingsLabel: "Media Managers",
  },
  "check-arr-quality": {
    kind: "system",
    group: "library",
    description:
      "Compares the quality profiles Tinkerbell manages with their presets, and reports any changed outside Tinkerbell. It never changes them.",
    settingsHref: "/arrs",
    settingsLabel: "Instances",
  },
  "scan-problems": {
    kind: "system",
    group: "library",
    description:
      "Compares each Sonarr series with its Plex show episode by episode, and checks your library and rules for problems. It never fixes anything — that is done from the Problems page.",
    settingsHref: "/problems",
    settingsLabel: "Problems",
  },
  generate: {
    kind: "system",
    group: "automation",
    description: "Builds and updates rule-based collections in Plex from the rules you've defined.",
  },
  cleanup: {
    kind: "system",
    group: "automation",
    description:
      "Runs your cleanup rules: tracks what matches across runs and deletes or unmonitors it once it has matched enough times in a row.",
    settingsHref: "/settings/cleanup",
    settingsLabel: "Cleanup",
  },
  metadata: {
    kind: "system",
    group: "automation",
    description: "Runs your metadata rules, writing titles, summaries, labels and other fields onto matching items.",
    settingsHref: "/settings/metadata",
    settingsLabel: "Metadata",
  },
  "metadata-overrides": {
    kind: "system",
    group: "automation",
    description:
      "Writes per-item metadata edits — such as those imported from Kometa — onto the matching items in Plex. Edits that can't be matched to exactly one item are left alone.",
    settingsHref: "/settings/metadata",
    settingsLabel: "Metadata",
  },
  "purge-runs": {
    kind: "system",
    group: "maintenance",
    description:
      "Deletes job run records older than 7 days, and prunes health-check entries and bandwidth test results past their retention.",
  },
  backup: {
    kind: "system",
    group: "maintenance",
    description: "Snapshots the database to the backup folder and keeps the most recent copies.",
    settingsHref: "/settings/backup",
    settingsLabel: "Backup & Restore",
  },
  "sync-recently-added": {
    kind: "system",
    group: "background",
    description: "Refreshes the cached “Recently Added” stats shown on the dashboard.",
  },
  "sync-users": {
    kind: "system",
    group: "library",
    description: "Pulls the list of Plex users and their library access into the local database.",
  },
  "seerr-poll": {
    kind: "system",
    group: "background",
    description:
      "Checks Overseerr for requests that have become available, which is what fires the “request fulfilled” rule trigger. Does nothing when Overseerr isn't configured.",
  },
  "arr-poll": {
    kind: "system",
    group: "background",
    description: "Polls Radarr and Sonarr download queues so the dashboard shows what is downloading.",
  },
  "watchlist-sync": {
    kind: "system",
    group: "background",
    description:
      "Checks your Plex watchlist and sends anything not already in your library to Radarr or Sonarr. Each item is only ever acted on once, so a failed request is retried rather than repeated.",
    settingsHref: "/settings/watchlist",
    settingsLabel: "Watchlist",
  },
  "rule-schedules": {
    kind: "system",
    group: "background",
    description: "Starts rules that have their own schedule when it comes due.",
  },
  healthcheck: {
    kind: "system",
    group: "background",
    description: "Pings every configured external service and records its current health status.",
    settingsHref: "/settings/health",
    settingsLabel: "Health",
  },
  "playback-poll": {
    kind: "system",
    group: "background",
    description: "Records what is playing right now. Every watch statistic is derived from these samples.",
  },
  "bandwidth-test": {
    kind: "system",
    group: "maintenance",
    description:
      "Measures this server's internet download and upload speed against Cloudflare, and records the result. Moves up to 200 MB per run, and only on a link fast enough to do so in seconds.",
    settingsHref: "/settings/bandwidth",
    settingsLabel: "Bandwidth Test",
  },
  "collections-sweep": {
    kind: "system",
    group: "automation",
    description:
      "Finds collections Tinkerbell made that no rule produces any more — and duplicates of ones it does — and deletes them from Plex.",
  },
  "registry-updates": {
    kind: "system",
    group: "maintenance",
    description:
      "Checks the public rule registry for newer versions of the rules you've imported, and raises an event the first time each one appears. Never applies an update on its own.",
  },
  "posters-refresh": {
    kind: "system",
    group: "library",
    description: "Re-fetches cached poster images and detects when artwork has changed in Plex.",
  },
  "collection-art": {
    kind: "system",
    group: "automation",
    description: "Renders and uploads generated artwork for collections whose rules ask for it.",
    settingsHref: "/settings/appearance",
    settingsLabel: "Appearance",
  },
  "playback-backfill": {
    kind: "system",
    group: "library",
    schedule: "hidden",
    description: "Imports Plex's own watch history once, so statistics start with your past viewing.",
  },

  // ── Features ────────────────────────────────────────────────────────────
  "because-you-watched": {
    kind: "feature",
    requires: "Personalized Home Screens and an AI provider.",
    description:
      "Generates personalised “Because You Watched” collections for each Plex user using their recent watch history.",
  },
  "we-think-youd-like": {
    kind: "feature",
    requires: "Personalized Home Screens, an AI provider, and recorded watch history.",
    description:
      "Builds one “We Think You'd Like” collection per library for each Plex user, from a taste profile of their whole recent watch history.",
  },
  personalize: {
    kind: "feature",
    requires: "Personalized Home Screens, and rules marked personalizable.",
    description:
      "For each opted-in user, re-runs the rules you've marked personalizable using their preferences, and pins the results to their own home screen.",
  },
  shuffle: {
    kind: "feature",
    description: "Randomises the order of items in shuffled hub collections so the homescreen stays fresh.",
  },
  overlays: {
    kind: "feature",
    requires: "Overlay styles set up on the Overlays page.",
    description: "Renders configured overlays onto poster artwork and uploads the composited posters to Plex.",
  },
  digest: {
    kind: "feature",
    requires: "A notification service routed for the digest, or email set up for portal users.",
    description:
      "Sends a periodic summary of what was added, watched and is about to be removed — to your own notification channels, and by email to portal users who asked for one.",
  },

  // ── Hidden: one-shot actions driven from another page ───────────────────
  label: {
    kind: "hidden",
    description:
      "Labels managed items and configures Plex sharing so each user only sees the collections they're permitted to.",
  },
  "label-undo": {
    kind: "hidden",
    description:
      "Removes the Tinkerbell label from items and strips per-user labels from collections. Does not change sharing restrictions.",
  },
  "metadata-undo": {
    kind: "hidden",
    description: "Reverts a batch of metadata changes to the values recorded before they were written.",
  },
  "byw-remove": {
    kind: "hidden",
    description:
      "Tears down Because You Watched: deletes its collections from Plex and clears every shared user's sharing restrictions. Item-level Tinkerbell labels are left intact.",
  },
  "wtyl-remove": {
    kind: "hidden",
    description:
      "Tears down We Think You'd Like: deletes its collections from Plex. Sharing restrictions belong to Personalized Home Screens and are left alone.",
  },
  "personalize-enable": {
    kind: "hidden",
    description: "Turns on Personalized Home Screens: labels your libraries and restricts each shared user's access.",
  },
  "personalize-disable": {
    kind: "hidden",
    description: "Turns off Personalized Home Screens and restores every user's previous sharing settings.",
  },
  "overlays-remove": {
    kind: "hidden",
    description: "Restores original poster artwork by removing previously applied overlays.",
  },
  "migrate-collections": {
    kind: "hidden",
    description:
      "Imports existing Plex collections into Tinkerbell rule-based collections, optionally deleting the originals.",
  },
  "preroll-process": {
    kind: "hidden",
    description: "Probes and normalises uploaded prerolls, then updates Plex's preroll setting.",
    settingsHref: "/prerolls",
    settingsLabel: "Prerolls",
  },
};

const UNKNOWN: Required<Omit<JobPresentation, "settingsHref" | "settingsLabel" | "requires" | "group">> = {
  kind: "system",
  schedule: "editable",
  description: "",
};

export function jobPresentation(id: string): JobPresentation & { schedule: "editable" | "hidden" } {
  const entry = JOB_PRESENTATION[id];
  return entry ? { ...UNKNOWN, ...entry, schedule: entry.schedule ?? "editable" } : UNKNOWN;
}

/** An id nothing lists still gets a section — the last real one, not a gap. */
export function systemGroupOf(id: string): SystemGroup {
  return JOB_PRESENTATION[id]?.group ?? "maintenance";
}
