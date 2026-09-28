/**
 * Job ids that are pinned always-on: infrastructure and one-shot actions the
 * user is never offered a switch for.
 *
 * This lives in contracts because the claim has to be made in two places at
 * once. `apps/web`'s `fields.ts` renders these with a static "Required" /
 * "Always on" pill and no toggle; `seedDefaultJobs` forces their `enabled`
 * column to 1. When the list lived only in the web app, nothing kept the
 * column in step with the pill — a row that reached `enabled = 0` (an older
 * build where it was toggleable, a portability import, a hand-edit) showed
 * "Required", offered no way to turn it back on, and was skipped by
 * `registerCrons`, which only schedules `enabled = 1`. Three system jobs sat
 * dead for five weeks that way, with "Never" in the Last Run column as the
 * only tell.
 */
export const ALWAYS_ON_JOB_IDS = [
  "bandwidth-test",
  "byw-remove",
  "collections-sweep",
  "generate",
  "healthcheck",
  "label",
  "personalize-disable",
  "personalize-enable",
  "playback-backfill",
  "posters-refresh",
  "preroll-process",
  "purge-runs",
  "registry-updates",
  "sync-collections",
  "sync-media",
  "sync-recently-added",
  "sync-users",
] as const;

export type AlwaysOnJobId = (typeof ALWAYS_ON_JOB_IDS)[number];

const alwaysOn: ReadonlySet<string> = new Set(ALWAYS_ON_JOB_IDS);

export function isAlwaysOnJob(jobId: string): boolean {
  return alwaysOn.has(jobId);
}
