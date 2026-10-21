import { perDeps } from "@rube/container";
import { type Services } from "@rube/composition";
import { createRegistryUpdates } from "./registry-updates.ts";
import { createRuleSchedules } from "./rule-schedules.ts";
import { createRuleTriggers } from "./rule-triggers.ts";
import { createSeerrPoll } from "./seerr-poll.ts";
import { pollArrQueues } from "./arr-poll.ts";
import { labelNewArrivals } from "./personalize/label-new-arrivals.ts";
import { createPlexClient } from "@rube/plex";
/**
 * Internal jobs run in-process rather than through the Sidequest command
 * pattern — they are short, purely local, and not worth a worker thread.
 *
 * They still get a real `JobContext` (log/progress/signal/checkpoint) and are
 * still cancellable, so from the UI's point of view they behave like any other
 * job. Each returns the line that becomes the run's `message` and final `log`.
 */
import { and, lt, notInArray } from "drizzle-orm";
import { DAY_MS, MINUTE_MS, type JobContext } from "@rube/core";
import { jobRuns } from "@rube/db";
import { formatFileSize } from "@rube/contracts";

import { DEFAULT_RETENTION_DAYS as METADATA_DEFAULT_RETENTION_DAYS } from "@rube/domain.metadata";

import { DEFAULT_HISTORY_RETENTION_DAYS } from "@rube/domain.config-history";

import { RULE_RUN_RETENTION_MS } from "@rube/domain.rule-runs";

import { ACTIVE_RUN_STATUSES } from "./statuses.ts";
import { JOB_RUN_RETENTION_MS } from "./limits.ts";

export interface InternalJobDescriptor {
  run: (ctx: JobContext) => string | Promise<string>;
  /**
   * Wall-clock budget, same idea as a command's entry in the catalog.
   *
   * Internal jobs don't go through `CommandJob`, so they have no in-run
   * deadline — this is what lets the main-process watchdog force-fail one that
   * wedges. Without it a stuck `healthcheck` would occupy its job forever and
   * healthcheck would silently never run again, which is exactly the failure
   * the watchdog exists to prevent.
   */
  timeoutMs: number;
  /**
   * Suppress the routine `job.completed` event.
   *
   * `healthcheck` runs every minute — 1440 identical events a day, kept
   * tolerable only by `rollupConsecutiveEvents` collapsing them. Quiet jobs
   * emit only when the outcome text changes from the previous run. Failures
   * always emit, quiet or not.
   */
  quiet?: boolean;
}

/**
 * The internal jobs marked `quiet` below, by command, for code that has no
 * `Services` to build the descriptors with — `getRecentRuns` filters on it.
 * `internal-jobs.test.ts` holds the two lists equal.
 */
export const QUIET_INTERNAL_JOBS: readonly string[] = [
  "healthcheck",
  "registry-updates",
  "rule-schedules",
  "seerr-poll",
  "quality-swaps",
  "watchlist-sync",
  "arr-poll",
  "playback-poll",
];

export type InternalJobs = ReturnType<typeof createInternalJobs>["internalJobs"];
export type InternalJobName = keyof InternalJobs;

export const createInternalJobs = perDeps(function createInternalJobs(deps: Services) {
  const {
    aiUsage,
    backups,
    bandwidth,
    clients,
    config,
    configHistory,
    db,
    health,
    match,
    metadata,
    playback,
    qualitySwaps,
    ruleRuns,
    rules,
    stats,
    watchlist,
  } = deps;
  const { getConfig } = config;
  const { pruneBandwidthSamples, pruneBandwidthTests, runBandwidthTest } = bandwidth;
  const { pruneOlderThan } = metadata;
  const { pruneLlmUsage } = aiUsage;
  const { runBackup, backupsEnabled } = backups;
  const { pruneChangeLog } = configHistory;
  const { pruneHealthChecks, checkAllConfiguredServices } = health;
  const { pruneRuleRuns, pruneRunChanges } = ruleRuns;
  const { pollPlaybackOnce } = playback;
  const { pruneDeletedRules } = rules;
  const { syncWatchlist } = watchlist;
  const { getCachedRecentlyAdded, syncRecentlyAdded } = stats;
  const { announceRegistryUpdates } = createRegistryUpdates(deps);
  const { runDueRules } = createRuleSchedules(deps);
  const { runTriggeredRules } = createRuleTriggers(deps);
  const { pollSeerrRequests } = createSeerrPoll(deps);

  /**
   * The personalization label for anything that arrived since the last tick.
   *
   * It runs here, and not only in the nightly `sync-media`, because a new title
   * is invisible to every shared user until it carries the label: nightly meant
   * up to a day's wait. It labels from Plex's `label!=` filter rather than from
   * the recently-added list, which holds 20 items and misses the rest of a batch
   * import. The outcome goes in the summary only when something was labelled,
   * so the job's message doesn't change every 15 minutes for nothing.
   */
  async function labelNewArrivalsNow(ctx: JobContext): Promise<string | undefined> {
    const url = getConfig("global_plex_url");
    const token = getConfig("global_plex_token");
    if (!url || !token) return undefined;
    const client = createPlexClient({ url, token, signal: ctx.signal, onHealth: clients.plexHealthCallback });
    const libraries = getConfig("global_plex_libraries");
    const sections = (await client.getSections()).filter((s) => !libraries || libraries.includes(s.title));
    const result = await labelNewArrivals(deps, client, sections, ctx.signal);
    ctx.log(result.message);
    return result.labelled > 0 || result.failed > 0 ? result.message : undefined;
  }

  const internalJobs = {
    "purge-runs": {
      run: (ctx: JobContext) => {
        const cutoff = Date.now() - JOB_RUN_RETENTION_MS;
        const result = db
          .delete(jobRuns)
          // `cancelling` is excluded alongside `running`: the command is still
          // executing and still owns the row until it writes its terminal status.
          .where(and(notInArray(jobRuns.status, [...ACTIVE_RUN_STATUSES]), lt(jobRuns.startedAt, cutoff)))
          .run();
        // Rule runs are far more numerous than job runs — one Generate job writes
        // a row per rule — so they are purged on the same schedule.
        const ruleRunsPurged = pruneRuleRuns(Date.now() - RULE_RUN_RETENTION_MS);
        ctx.progress(1, 2, "Pruning health checks and bandwidth history");
        pruneHealthChecks();
        pruneBandwidthTests();
        // The usage samples are the fastest-growing table here: one row per
        // 30-second poll, whether or not anything was streaming.
        pruneBandwidthSamples();
        // Kept for 13 months rather than the week the runs get: the question
        // it answers is "how does this month compare", not "what just ran".
        pruneLlmUsage();
        // Undo has a window; past it the tombstone is just a copy of a rule
        // nobody can reach.
        const tombstones = pruneDeletedRules();
        // Changesets are pruned by age rather than by count, because their size
        // tracks library churn rather than how many runs happened.
        const changesPurged = pruneRunChanges(RULE_RUN_RETENTION_MS);
        // Metadata snapshots keep their own, much longer window: they are what
        // makes a write undoable, and 7 days is shorter than the gap between a
        // bad nightly run and somebody noticing a title looks wrong.
        const retentionDays = getConfig("metadata_undo_retention_days") ?? METADATA_DEFAULT_RETENTION_DAYS;
        const metadataPurged = pruneOlderThan(Date.now() - retentionDays * DAY_MS);
        // The settings history keeps the longest window of anything here. It is
        // small (a row per edit, not per item) and the question it answers —
        // "when did this stop working?" — is usually asked months late.
        const historyPurged = pruneChangeLog(Date.now() - DEFAULT_HISTORY_RETENTION_DAYS * DAY_MS);
        // Movie-match rooms nobody has opened for a month. They already read as
        // gone past that point; this is what actually frees the rows.
        const roomsPurged = match.pruneStaleRooms();
        return (
          `Purged ${result.changes} job run(s) and ${ruleRunsPurged} rule run(s) older than 7 days` +
          `${changesPurged > 0 ? `, ${changesPurged} run change(s)` : ""}` +
          `${tombstones > 0 ? `, ${tombstones} deleted-rule record(s)` : ""}` +
          `${metadataPurged > 0 ? `, ${metadataPurged} metadata snapshot(s) older than ${retentionDays} days` : ""}` +
          `${historyPurged > 0 ? `, ${historyPurged} settings-history entr${historyPurged === 1 ? "y" : "ies"}` : ""}` +
          `${roomsPurged > 0 ? `, ${roomsPurged} movie-match room${roomsPurged === 1 ? "" : "s"}` : ""}.`
        );
      },
      timeoutMs: 10 * MINUTE_MS,
    },
    /**
     * The nightly copy of the database.
     *
     * An internal job rather than a Sidequest command, and the reason is
     * scheduling rather than size: commands queue behind each other on a lane,
     * and a backup that waits four hours for a `generate` to finish is a
     * backup taken at 5am on a database that has just been rewritten. This
     * runs in-process, in seconds, at the time it was asked to.
     */
    backup: {
      run: async (ctx: JobContext) => {
        if (!backupsEnabled()) return "Backups are switched off in Settings → Backup & Restore.";
        ctx.progress(0, 2, "Copying the database");
        const result = await runBackup((message) => ctx.progress(1, 2, message));
        return (
          `Backed up to ${result.name} (${formatFileSize(result.sizeBytes)})` +
          `${result.pruned > 0 ? `, removed ${result.pruned} older backup${result.pruned === 1 ? "" : "s"}` : ""}.`
        );
      },
      timeoutMs: 15 * MINUTE_MS,
    },
    "sync-recently-added": {
      run: async (ctx: JobContext) => {
        // The added-item trigger rides on this job rather than polling Plex
        // again: this is already the thing that knows what showed up, and a
        // second poller asking the same question would be a second answer to
        // keep consistent.
        const before = new Set(getCachedRecentlyAdded().items.map((i) => i.ratingKey));
        const summary = await syncRecentlyAdded(ctx.signal);
        const added = getCachedRecentlyAdded().items.filter((i) => i.ratingKey && !before.has(i.ratingKey));
        const triggered = await runTriggeredRules(ctx, "item-added", added.length);
        const labels = await labelNewArrivalsNow(ctx);
        return [summary, labels, triggered].filter(Boolean).join(". ");
      },
      timeoutMs: 10 * MINUTE_MS,
    },
    healthcheck: {
      run: (ctx: JobContext) => checkAllConfiguredServices(ctx.signal),
      // Runs every minute. Anything past 5 is wedged, not slow.
      timeoutMs: 5 * MINUTE_MS,
      quiet: true,
    },
    "bandwidth-test": {
      run: (ctx: JobContext) => runBandwidthTest(ctx),
      // The test bounds itself at 90s. Past three minutes it is wedged on a
      // socket that never closed, not measuring a very slow link.
      timeoutMs: 3 * MINUTE_MS,
    },
    "registry-updates": {
      run: () => announceRegistryUpdates(),
      // One HTTP GET against a cached index. Past a minute the registry host is
      // hanging on us, and `fetchRegistryIndex` has its own 15s timeout anyway.
      timeoutMs: 5 * MINUTE_MS,
      // Daily, and quiet: the interesting outcome is the event it emits, not the
      // 364 runs a year that find nothing new.
      quiet: true,
    },
    "rule-schedules": {
      run: (ctx: JobContext) => runDueRules(ctx),
      // Ticks every minute and finishes in milliseconds: it decides what is due
      // and queues it, and the rule queue runs it. It used to execute whole rules
      // inside the tick and so needed half an hour, which meant the watchdog
      // could not tell a wedged tick from a busy one until long after it mattered.
      timeoutMs: 5 * MINUTE_MS,
      // Most minutes there is nothing due, and "No rule schedules due." is the
      // stable text that keeps those minutes out of the activity feed.
      quiet: true,
    },
    "seerr-poll": {
      run: (ctx: JobContext) => pollSeerrRequests(ctx),
      // One paged GET against Overseerr, and then at most a few queue inserts.
      // The rules it wakes are the queue's problem, not this job's.
      timeoutMs: 10 * MINUTE_MS,
      // Most polls find nothing new, and "No newly available requests." said
      // ninety-six times a day is not information.
      quiet: true,
    },
    /**
     * Plex Watchlist → Radarr/Sonarr.
     *
     * An internal job rather than a Sidequest command, which is a departure
     * from the plan, and for the same reason `backup` is one: a command queues
     * on a lane, and a fifteen-minute poll that can wait four hours behind
     * `generate` is not a fifteen-minute poll. It is also cheap enough not to
     * want a worker thread — most runs are one paged GET against plex.tv and
     * nothing else, because the expensive half only happens when the list has
     * something on it we have never acted on.
     */
    /**
     * Moves each 4K→1080p swap on a step: one interactive search per run
     * (they hit every indexer), plus the cheap queue and import polls.
     * In-process because the common run is "nothing to do", answered by one
     * indexed SELECT, and a worker thread for that would be most of the cost.
     */
    "quality-swaps": {
      run: async (ctx: JobContext) => {
        if (qualitySwaps.activeCount() === 0) return "No swaps in progress.";
        const r = await qualitySwaps.advanceAll({ signal: ctx.signal, searchBudget: 1, log: ctx.log });
        const parts = [`${r.active} swap(s) in progress`];
        if (r.waiting) parts.push(`${r.waiting} waiting to search`);
        if (r.errors) parts.push(`${r.errors} will retry`);
        return `${parts.join(", ")}.`;
      },
      // The release search alone is allowed three minutes by the Radarr client.
      timeoutMs: 10 * MINUTE_MS,
      quiet: true,
    },
    "watchlist-sync": {
      run: (ctx: JobContext) => syncWatchlist(ctx),
      // The library index it may have to build is the slow part, and that is
      // one paged walk per movie/show section — the same shape of work
      // `sync-media` gets two hours for, over far fewer items.
      timeoutMs: 30 * MINUTE_MS,
      // Ninety-six runs a day, and the interesting outcome is the request it
      // makes, which is its own event. "Nothing new" said all day is not.
      quiet: true,
    },
    /**
     * The *Arr queue count, for the nav badge.
     *
     * An internal job for the same reason `seerr-poll` is one: it is a single
     * tiny GET per instance, and queueing that behind `generate` on a lane
     * would make a one-minute poll a four-hour one.
     */
    "arr-poll": {
      run: (ctx: JobContext) => pollArrQueues(ctx),
      // One `/queue/status` per instance and nothing else.
      timeoutMs: 2 * MINUTE_MS,
      // Runs constantly, and "Nothing downloading." said all day is not
      // information. The stable text is what lets `quiet` suppress it.
      quiet: true,
    },
    "playback-poll": {
      run: async (ctx: JobContext) => {
        const result = await pollPlaybackOnce(ctx.signal);
        if (!result.polled) return "Playback poll skipped.";
        const parts = [];
        if (result.recovered) parts.push(`recovered ${result.recovered} session(s) after restart`);
        if (result.opened) parts.push(`opened ${result.opened}`);
        if (result.closed) parts.push(`closed ${result.closed}`);
        // Fires on a *completed* play, not on any close. "Watched" has to mean
        // the same thing here as it does in `watch_state`, or a rule that
        // collects what you finished would also collect what you gave up on.
        const triggered = await runTriggeredRules(ctx, "item-watched", result.completed);
        if (triggered) parts.push(triggered);
        // The quiet flag suppresses the event only when this text is unchanged,
        // so a tick where nothing happened must produce a stable string — hence
        // one phrasing for "no change" rather than counts that are always zero.
        return parts.length ? `Playback: ${parts.join(", ")}.` : "Playback poll: no change.";
      },
      // Runs every 30 seconds. A tick that finds a completed play queues the
      // rules listening for it rather than running them here — half an hour of
      // budget for a poll that should take milliseconds meant a wedged poller
      // went unnoticed for half an hour. The in-flight latch drops overlapping
      // ticks, so a slow one delays the next poll rather than doubling it.
      timeoutMs: 5 * MINUTE_MS,
      quiet: true,
    },
  } as const satisfies Record<string, InternalJobDescriptor>;

  function isInternalJobName(name: string): name is InternalJobName {
    return Object.hasOwn(internalJobs, name);
  }

  return { internalJobs, isInternalJobName };
});
