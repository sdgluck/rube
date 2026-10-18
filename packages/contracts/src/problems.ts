/**
 * The vocabulary of the Problems page.
 *
 * Here rather than in `domains/problems` because the browser needs the labels
 * and explanations, and it cannot import a domain. The kinds are the union of
 * what the old *Arr reconciliation page reported and the library checks added
 * beside it; the two never-implemented *Arr kinds (`stuckInQueue`,
 * `settingsDrift`) were dropped rather than carried as dead labels.
 */

export const PROBLEM_KINDS = [
  "episodeOrdering",
  "missingEpisodes",
  "inArrNotInPlex",
  "failedImport",
  "unknownSize",
  "ruleFailing",
  "ruleEmpty",
  "ruleConflict",
  "legacyAgent",
  "unmatched",
  "inPlexNotInArr",
  "duplicateAcrossInstances",
] as const;
export type ProblemKind = (typeof PROBLEM_KINDS)[number];

/**
 * - `fault` — something is wrong and someone should act.
 * - `advisory` — worth knowing, often intended. Counted apart so a library
 *   full of deliberately unmanaged films doesn't hold the badge up forever.
 */
export type ProblemSeverity = "fault" | "advisory";

export interface ProblemKindMeta {
  label: string;
  explanation: string;
  severity: ProblemSeverity;
  /** The verb on the Fix button, for kinds that have one. */
  fixLabel?: string;
}

export const PROBLEM_META: Record<ProblemKind, ProblemKindMeta> = {
  episodeOrdering: {
    label: "Episode ordering doesn't match your files",
    explanation:
      "Plex numbers these shows' episodes differently from Sonarr, so files land on the wrong episodes in Plex and show the wrong titles. Fixing sets the show's episode ordering to TheTVDB, which Sonarr names files by, and refreshes its metadata.",
    severity: "fault",
    fixLabel: "Fix ordering",
  },
  missingEpisodes: {
    label: "Episodes missing from Plex",
    explanation:
      "Sonarr has files for these episodes, but Plex doesn't list them. Usually a scan Plex hasn't done yet. Fixing scans the show's folder.",
    severity: "fault",
    fixLabel: "Scan folder",
  },
  inArrNotInPlex: {
    label: "Downloaded, not in Plex",
    explanation:
      "On disk, but no Plex item matches — often an unscanned library, or an item Plex matched to something else. Fixing asks Plex to scan the folder, at the path Plex knows it by.",
    severity: "fault",
    fixLabel: "Scan in Plex",
  },
  failedImport: {
    label: "Failed to import",
    explanation:
      "Grabbed more than a day ago, but never imported, and nothing else has been imported for it since. Fixing marks the grab failed in Radarr or Sonarr, which blocklists the release and lets it search for another.",
    severity: "fault",
    fixLabel: "Mark failed",
  },
  unknownSize: {
    label: "File sizes unknown",
    explanation:
      "Plex hasn't reported a size for some of these shows' episodes, so size-based rules and storage figures undercount them. Fixing asks Plex to analyse the show.",
    severity: "fault",
    fixLabel: "Analyse",
  },
  ruleFailing: {
    label: "Rule failing",
    explanation: "These rules' most recent run ended in an error.",
    severity: "fault",
  },
  ruleEmpty: {
    label: "Rule stopped matching",
    explanation:
      "These rules matched nothing on their last run, having matched something the run before. A source list that moved or a filter that no longer matches looks exactly like this.",
    severity: "fault",
  },
  ruleConflict: {
    label: "Rules in conflict",
    explanation: "Two or more rules fighting over the same collection, field or item. Whichever runs last wins.",
    severity: "fault",
  },
  legacyAgent: {
    label: "On a legacy agent",
    explanation:
      "Matched by one of Plex's retired agents. Episode ordering, and much of what the current agents provide, does nothing for these. Change the library's agent in Plex to move them.",
    severity: "advisory",
  },
  unmatched: {
    label: "Not matched in Plex",
    explanation:
      "Plex couldn't match these to any provider, so they carry no IMDb, TMDb or TVDB id. Rules that join on those ids skip them. Fix the match in Plex.",
    severity: "advisory",
  },
  inPlexNotInArr: {
    label: "In Plex, not managed",
    explanation: "In Plex, but no Radarr or Sonarr manages them. Often intended.",
    severity: "advisory",
  },
  duplicateAcrossInstances: {
    label: "In more than one instance",
    explanation: "Files in more than one instance. Fine on a 1080p/4K split.",
    severity: "advisory",
  },
};

export function isProblemKind(value: string): value is ProblemKind {
  return (PROBLEM_KINDS as readonly string[]).includes(value);
}
