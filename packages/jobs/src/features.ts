import { type Services } from "@rube/composition";
import { createRunner, JobUpdateError } from "./runner.ts";
import { createSchedule } from "./schedule.ts";
/**
 * User-installable feature templates. Plugs into the lifecycle in
 * runner.ts via `scheduleCron`, `startJob`, and `cancelRun` (which live
 * there because they also drive system jobs). Extracted from runner.ts
 * (GET-122).
 */
import { and, inArray, eq } from "drizzle-orm";
import { jobs, jobRuns } from "@rube/db";
import { createLogger, errorMessage } from "@rube/core";
import { validateJobConfig } from "@rube/contracts";
import { DEFAULT_JOB_RUN_LIMIT } from "./limits.ts";
import { Cron } from "croner";

import type { CommandName } from "./commands/catalog.ts";
import { cronJobs } from "./schedule.ts";
import { createReadiness, type ReadinessItem } from "./readiness.ts";

const log = createLogger("jobs");

export interface FeatureTemplate {
  id: string;
  name: string;
  /** Typed against the catalog so a rename there fails typecheck instead of at run time. */
  command: CommandName;
  defaultSchedule: string;
  defaultConfig: Record<string, unknown>;
  /** Feature only works while the personalization master switch is enabled. */
  requiresPersonalizedSharing?: boolean;
}

export const FEATURE_TEMPLATES: FeatureTemplate[] = [
  {
    id: "because-you-watched",
    name: "Because You Watched",
    command: "because-you-watched",
    defaultSchedule: "0 2 * * *",
    defaultConfig: { limit: DEFAULT_JOB_RUN_LIMIT },
    requiresPersonalizedSharing: true,
  },
  {
    id: "we-think-youd-like",
    name: "We Think You'd Like",
    command: "we-think-youd-like",
    // Weekly: a taste read from a year of history barely moves overnight, and
    // every run is a model call per person per library.
    defaultSchedule: "0 3 * * 0",
    defaultConfig: {},
    requiresPersonalizedSharing: true,
  },
  {
    id: "pick-it-back-up",
    name: "Pick It Back Up",
    command: "pick-it-back-up",
    // Nightly, after BYW: who stopped watching what moves day by day, and a
    // run is a few local queries, not a model call per person.
    defaultSchedule: "30 2 * * *",
    defaultConfig: {},
    requiresPersonalizedSharing: true,
  },
  {
    id: "finish-the-franchise",
    name: "Finish the Franchise",
    command: "finish-the-franchise",
    // Daily: finishing a film tonight should put the next one up by morning.
    // Clear of every schedule preset's night chain.
    defaultSchedule: "15 7 * * *",
    defaultConfig: {},
    requiresPersonalizedSharing: true,
  },
  {
    id: "watch-it-again",
    name: "Watch It Again",
    command: "watch-it-again",
    // Daily, so a film rewatched last night leaves the row by morning. Clear of every schedule preset's night chain.
    defaultSchedule: "05 7 * * *",
    defaultConfig: {},
    requiresPersonalizedSharing: true,
  },
  {
    id: "new-for-you",
    name: "New For You",
    command: "new-for-you",
    // Daily, after the night's media sync has indexed what arrived. Clear of every schedule preset's night chain.
    defaultSchedule: "10 7 * * *",
    defaultConfig: {},
    requiresPersonalizedSharing: true,
  },
  {
    id: "more-from",
    name: "More From\u2026",
    command: "more-from",
    // Daily. Clear of every schedule preset's night chain.
    defaultSchedule: "35 7 * * *",
    defaultConfig: {},
    requiresPersonalizedSharing: true,
  },
  {
    id: "requests-arrived",
    name: "Your Requests Are Here",
    command: "requests-arrived",
    // Daily, after the night's media sync has indexed what arrived. Clear of
    // every schedule preset's night chain.
    defaultSchedule: "25 7 * * *",
    defaultConfig: {},
    requiresPersonalizedSharing: true,
  },
  {
    id: "season-collections",
    name: "Season Collections",
    command: "season-collections",
    // Daily, so a holiday's row appears the morning its window opens and is
    // gone the morning after it closes. Out of season a run reads its config,
    // lists its rows and stops. 07:45 is after every schedule preset's night
    // chain, so no preset has to make room for it or warns about sharing a slot.
    defaultSchedule: "45 7 * * *",
    defaultConfig: {},
    // Not `requiresPersonalizedSharing`: the default is one row for everyone.
    // A row per person needs it, and readiness says so for that mode.
  },
  {
    id: "leaving-soon",
    name: "Leaving Soon",
    command: "leaving-soon",
    // Daily, after the night's cleanup has advanced the streaks and removed
    // what was due. Clear of every schedule preset's night chain.
    defaultSchedule: "20 7 * * *",
    defaultConfig: {},
  },
  {
    id: "shuffle",
    name: "Shuffle Hubs",
    command: "shuffle",
    defaultSchedule: "*/30 * * * *",
    defaultConfig: {},
  },
  {
    id: "overlays",
    name: "Apply Overlays",
    command: "overlays",
    defaultSchedule: "",
    defaultConfig: {},
  },
  {
    id: "digest",
    name: "Digest",
    command: "digest",
    // Monday morning. The newsletter convention, and there is no reason to be
    // original about it.
    defaultSchedule: "0 9 * * MON",
    defaultConfig: {
      frequency: "weekly",
      minAddedItems: 1,
      includeServerDigest: true,
      includeUserDigests: true,
    },
  },
];

/** The job that undoes what a feature left on the Plex server, started when the feature is removed. */
const TEARDOWN_JOBS: Record<string, CommandName> = {
  "because-you-watched": "byw-remove",
  "we-think-youd-like": "wtyl-remove",
  "pick-it-back-up": "pibu-remove",
  "season-collections": "season-remove",
  "leaving-soon": "leaving-remove",
  "finish-the-franchise": "franchise-remove",
  "requests-arrived": "requests-remove",
  "more-from": "more-from-remove",
  "new-for-you": "new-for-you-remove",
  "watch-it-again": "watch-again-remove",
};

function getFeatureTemplate(featureId: string): FeatureTemplate | undefined {
  return FEATURE_TEMPLATES.find((f) => f.id === featureId);
}

export interface FeatureCatalogEntry {
  id: string;
  name: string;
  command: CommandName;
  defaultSchedule: string;
  defaultConfig: Record<string, unknown>;
  /** What it needs that's set elsewhere — so the wizard can say so before install. */
  readiness: ReadinessItem[];
  installed: boolean;
  /** Requires the personalization master switch to be enabled. */
  requiresPersonalizedSharing: boolean;
  /** True when the feature can't be installed yet because its gate is off. */
  locked: boolean;
}

export function createFeatures(deps: Services) {
  const { config, configHistory, db } = deps;
  const { record: recordChange } = configHistory;
  const { getPersonalizedSharingStatus } = config;
  const { cancelRun, startJob } = createRunner(deps);
  const { scheduleCron } = createSchedule(deps);
  const { readinessFor } = createReadiness(deps);

  function listFeatureCatalog(): FeatureCatalogEntry[] {
    const installedIds = new Set(
      db
        .select({ id: jobs.id })
        .from(jobs)
        .all()
        .map((r) => r.id),
    );
    const sharingEnabled = getPersonalizedSharingStatus() === "enabled";
    return FEATURE_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      command: t.command,
      defaultSchedule: t.defaultSchedule,
      defaultConfig: t.defaultConfig,
      readiness: readinessFor({ id: t.id, command: t.command, config: t.defaultConfig }),
      installed: installedIds.has(t.id),
      requiresPersonalizedSharing: t.requiresPersonalizedSharing ?? false,
      locked: (t.requiresPersonalizedSharing ?? false) && !sharingEnabled,
    }));
  }

  function installFeature(featureId: string, opts: { schedule?: string; config?: Record<string, unknown> } = {}): void {
    const template = getFeatureTemplate(featureId);
    if (!template) throw new JobUpdateError(`Unknown feature "${featureId}"`);

    if (template.requiresPersonalizedSharing && getPersonalizedSharingStatus() !== "enabled") {
      throw new JobUpdateError(
        `"${template.name}" requires Personalized Home Screens to be enabled first (Settings → Personalization).`,
      );
    }

    const schedule = opts.schedule ?? template.defaultSchedule;
    if (schedule) {
      try {
        new Cron(schedule);
      } catch (err) {
        throw new JobUpdateError(`"${schedule}" isn't a valid schedule: ${errorMessage(err)}`);
      }
    }
    // Validated like any other job save: the wizard's settings are the same
    // fields the job page edits, and an install is the first save.
    const config = validateJobConfig(template.command, template.id, { ...template.defaultConfig, ...opts.config });

    const existing = db.select().from(jobs).where(eq(jobs.id, featureId)).get();
    if (existing) {
      db.update(jobs).set({ schedule, enabled: 1, config }).where(eq(jobs.id, featureId)).run();
    } else {
      db.insert(jobs)
        .values({
          id: template.id,
          name: template.name,
          command: template.command,
          schedule,
          enabled: 1,
          config,
        })
        .run();
    }

    recordChange({
      entity: "job",
      entityId: template.id,
      action: existing ? "update" : "create",
      before: existing
        ? { schedule: existing.schedule, enabled: existing.enabled, config: existing.config }
        : undefined,
      after: { schedule, enabled: 1, config },
    });

    scheduleCron({ id: template.id, name: template.name, enabled: 1, schedule });
  }

  async function uninstallFeature(featureId: string): Promise<void> {
    const template = getFeatureTemplate(featureId);
    if (!template) throw new Error(`Unknown feature "${featureId}"`);

    // Stop any cron schedule first.
    const cron = cronJobs.get(featureId);
    if (cron) {
      cron.stop();
      cronJobs.delete(featureId);
    }

    const row = db.select().from(jobs).where(eq(jobs.id, featureId)).get();

    // Delete run history then the row itself (FK constraint).
    db.delete(jobRuns).where(eq(jobRuns.jobId, featureId)).run();
    db.delete(jobs).where(eq(jobs.id, featureId)).run();
    if (row) {
      recordChange({
        entity: "job",
        entityId: featureId,
        action: "delete",
        before: { schedule: row.schedule, enabled: row.enabled, config: row.config },
      });
    }

    // Per-feature cleanup hooks. BYW leaves per-user sharing restrictions and
    // collections on the Plex server, We Think You'd Like its collections —
    // fire the teardown job so removing the feature actually undoes those
    // side-effects. Item-level Rube labels are NOT touched here; users
    // can clean those up via Settings → Maintenance.
    const teardown = TEARDOWN_JOBS[featureId];
    if (teardown) {
      // Cancel any in-flight run first so we don't race with the cleanup.
      const active = db
        .select({ id: jobRuns.id })
        .from(jobRuns)
        .where(and(eq(jobRuns.jobId, featureId), inArray(jobRuns.status, ["running", "cancelling"])))
        .all();
      for (const run of active) {
        cancelRun(run.id);
      }
      try {
        const result = await startJob(teardown);
        if (!result.ok) {
          log.warn(`${featureId} uninstall: ${teardown} did not start`, { reason: result.reason });
        }
      } catch (err) {
        log.error(`${featureId} uninstall: failed to start ${teardown}`, {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { listFeatureCatalog, installFeature, uninstallFeature };
}
