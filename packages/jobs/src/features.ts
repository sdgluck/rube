import { type Services } from "@tinkerbell/composition";
import { createRunner } from "./runner.ts";
import { createSchedule } from "./schedule.ts";
/**
 * User-installable feature templates. Plugs into the lifecycle in
 * runner.ts via `scheduleCron`, `startJob`, and `cancelRun` (which live
 * there because they also drive system jobs). Extracted from runner.ts
 * (GET-122).
 */
import { and, inArray, eq } from "drizzle-orm";
import { jobs, jobRuns } from "@tinkerbell/db";
import { createLogger } from "@tinkerbell/core";
import { DEFAULT_JOB_RUN_LIMIT } from "./limits.ts";
import { Cron } from "croner";

import type { CommandName } from "./commands/catalog.ts";
import { cronJobs } from "./schedule.ts";

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
    id: "personalize",
    name: "Personalized Collections",
    command: "personalize",
    defaultSchedule: "0 3 * * *",
    defaultConfig: {},
    requiresPersonalizedSharing: true,
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

function getFeatureTemplate(featureId: string): FeatureTemplate | undefined {
  return FEATURE_TEMPLATES.find((f) => f.id === featureId);
}

export interface FeatureCatalogEntry {
  id: string;
  name: string;
  installed: boolean;
  /** Requires the personalization master switch to be enabled. */
  requiresPersonalizedSharing: boolean;
  /** True when the feature can't be installed yet because its gate is off. */
  locked: boolean;
}

export function createFeatures(deps: Services) {
  const { config, db } = deps;
  const { getPersonalizedSharingStatus } = config;
  const { cancelRun, startJob } = createRunner(deps);
  const { scheduleCron } = createSchedule(deps);

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
      installed: installedIds.has(t.id),
      requiresPersonalizedSharing: t.requiresPersonalizedSharing ?? false,
      locked: (t.requiresPersonalizedSharing ?? false) && !sharingEnabled,
    }));
  }

  function installFeature(featureId: string, opts: { schedule?: string; config?: Record<string, unknown> } = {}): void {
    const template = getFeatureTemplate(featureId);
    if (!template) throw new Error(`Unknown feature "${featureId}"`);

    if (template.requiresPersonalizedSharing && getPersonalizedSharingStatus() !== "enabled") {
      throw new Error(
        `"${template.name}" requires Personalized Home Screens to be enabled first (Settings → Personalization).`,
      );
    }

    const schedule = opts.schedule ?? template.defaultSchedule;
    if (schedule) new Cron(schedule); // validate
    const config = opts.config ?? template.defaultConfig;

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

    // Delete run history then the row itself (FK constraint).
    db.delete(jobRuns).where(eq(jobRuns.jobId, featureId)).run();
    db.delete(jobs).where(eq(jobs.id, featureId)).run();

    // Per-feature cleanup hooks. BYW leaves per-user sharing restrictions and
    // collections on the Plex server — fire byw-remove so removing the feature
    // actually undoes those side-effects. Item-level Tinkerbell labels are NOT
    // touched here; users can clean those up via Settings → Maintenance.
    if (featureId === "because-you-watched") {
      // Cancel any in-flight BYW run first so we don't race with the cleanup.
      const active = db
        .select({ id: jobRuns.id })
        .from(jobRuns)
        .where(and(eq(jobRuns.jobId, "because-you-watched"), inArray(jobRuns.status, ["running", "cancelling"])))
        .all();
      for (const run of active) {
        cancelRun(run.id);
      }
      try {
        const result = await startJob("byw-remove");
        if (!result.ok) {
          log.warn("BYW uninstall: byw-remove did not start", { reason: result.reason });
        }
      } catch (err) {
        log.error("BYW uninstall: failed to start byw-remove", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { listFeatureCatalog, installFeature, uninstallFeature };
}
