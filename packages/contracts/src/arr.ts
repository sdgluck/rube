/**
 * The shared vocabulary for Radarr and Sonarr.
 *
 * Everything here is a value or a type the browser needs and cannot get any
 * other way: `apps/web` may not import `clients/radarr`, `domains/arr-library`
 * or anything else server-side. It is deliberately free of client imports so
 * that stays true, which means the constants below are the *contract* between
 * the two sides rather than a re-export of one side's opinion.
 */

import { z } from "zod";

export const ARR_SERVICES = ["radarr", "sonarr"] as const;
export type ArrService = (typeof ARR_SERVICES)[number];

export const ARR_SETTINGS_AREAS = ["profiles", "media", "indexers", "general"] as const;
export type ArrSettingsArea = (typeof ARR_SETTINGS_AREAS)[number];

export const ARR_SETTINGS_AREA_LABELS: Record<ArrSettingsArea, string> = {
  profiles: "Profiles & Quality",
  media: "Media Management",
  indexers: "Indexers & Downloads",
  general: "Tags & Connections",
};

/**
 * Capabilities, as the browser sees them.
 *
 * The union of what Radarr and Sonarr can each report. The UI asks "does this
 * instance have custom formats?", never "is this Sonarr?" — the two questions
 * have different answers on Sonarr v3, and the version-shaped one is the
 * correct one to ask.
 */
export const ARR_CAPABILITIES = [
  "customFormats",
  "languageProfiles",
  "releaseProfiles",
  "movieEditor",
  "seriesEditor",
  "collections",
] as const;
export type ArrCapability = (typeof ARR_CAPABILITIES)[number];

/**
 * How a series should be monitored on add. Sonarr only — Radarr's monitoring
 * is a boolean, and there is no shared type that honestly covers both.
 */
export const SERIES_MONITOR_MODES = [
  "all",
  "future",
  "missing",
  "existing",
  "firstSeason",
  "lastSeason",
  "latestSeason",
  "pilot",
  "none",
] as const;
export type SeriesMonitorMode = (typeof SERIES_MONITOR_MODES)[number];

/** Radarr's availability gate — when a movie becomes eligible to grab. */
export const MINIMUM_AVAILABILITY = ["tba", "announced", "inCinemas", "released"] as const;
export type MinimumAvailability = (typeof MINIMUM_AVAILABILITY)[number];

/**
 * The history event types worth naming.
 *
 * Not exhaustive — the *Arrs emit others, and `arr_activity` stores whatever
 * arrives. These are the ones the timeline and the reconciliation queries
 * branch on, so they need a spelling both sides agree about.
 */
export const ARR_ACTIVITY_EVENT_TYPES = [
  "grabbed",
  "downloadFolderImported",
  "downloadFailed",
  "downloadIgnored",
  "movieFileDeleted",
  "movieFileRenamed",
  "episodeFileDeleted",
  "episodeFileRenamed",
] as const;
export type ArrActivityEventType = (typeof ARR_ACTIVITY_EVENT_TYPES)[number];

/** Queue states that mean "this needs a human". */
export const STUCK_QUEUE_STATES = ["importBlocked", "importPending", "failedPending"] as const;

/**
 * An instance, as the browser is allowed to see it.
 *
 * There is no `url` and no `apiKey`, and there must never be. An audit fix
 * already had to remove *Arr keys that were reaching the browser in full; a
 * picker needs a name and an id and nothing else.
 */
export interface ArrInstanceSummary {
  id: string;
  service: ArrService;
  name: string;
  isDefault: boolean;
}

/**
 * Where an added title should go.
 *
 * Deliberately the same vocabulary as `RuleConfig.arr` — instance, profile,
 * root folder, monitor, search — because it is the same decision. A second
 * spelling of it would mean two places to fix when a field is added.
 */
export const arrAddTargetSchema = z.object({
  service: z.enum(ARR_SERVICES),
  /** Absent means the service's default instance. */
  instanceId: z.string().optional(),
  qualityProfileId: z.number().int(),
  rootFolderPath: z.string(),
  monitor: z.boolean(),
  searchOnAdd: z.boolean(),
  minimumAvailability: z.enum(MINIMUM_AVAILABILITY).optional(),
  seriesMonitorMode: z.enum(SERIES_MONITOR_MODES).optional(),
  tags: z.array(z.number().int()).optional(),
});
export type ArrAddTarget = z.infer<typeof arrAddTargetSchema>;

/** What reconciliation can find. Each is one indexed query over the mirror. */
export const ARR_ISSUE_KINDS = [
  "inPlexNotInArr",
  "inArrNotInPlex",
  "duplicateAcrossInstances",
  "stuckInQueue",
  "failedImport",
  "settingsDrift",
] as const;
export type ArrIssueKind = (typeof ARR_ISSUE_KINDS)[number];

export const ARR_ISSUE_LABELS: Record<ArrIssueKind, string> = {
  inPlexNotInArr: "In Plex, not managed",
  inArrNotInPlex: "Downloaded, not in Plex",
  duplicateAcrossInstances: "In more than one instance",
  stuckInQueue: "Stuck in the queue",
  failedImport: "Failed to import",
  settingsDrift: "Instances disagree",
};

/** Bytes, as the *Arrs report them, to a human string. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/**
 * A custom format score, signed.
 *
 * The sign is the whole meaning — a negative score is a format being penalised
 * — so it is always rendered explicitly rather than left to `toString`.
 */
export function formatCustomFormatScore(score: number | null | undefined): string {
  if (score == null) return "—";
  return score > 0 ? `+${score}` : String(score);
}

/** How complete a series is, for a progress bar. Null when nothing is known. */
export function seriesProgress(episodeFileCount: number, episodeCount: number): number | null {
  if (!Number.isFinite(episodeCount) || episodeCount <= 0) return null;
  return Math.min(1, episodeFileCount / episodeCount);
}
