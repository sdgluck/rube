/**
 * The job system, as one factory.
 *
 * This barrel used to re-export forty functions that each closed over the
 * module-singleton database and config. They are factories now, so it exports
 * one — `createJobs(services)` — and the pure parts (schemas, catalogues,
 * predicates, type definitions) stay as ordinary module exports because they
 * are data rather than behaviour.
 *
 * `registerCoreHooks` is gone. It existed to assign four mutable slots in
 * `@tinkerbell/core` that each defaulted to a no-op, and had to be called by
 * every entrypoint; the Sidequest worker never called it, so every job ran
 * with health reporting, notification traces, migration rescans and collection
 * counts silently disabled. Building the container is the wiring now, and
 * `@tinkerbell/composition`'s resolve-all test fails if an edge is missing.
 */
import { perDeps, token, type Registry } from "@tinkerbell/container";
import { ServicesToken, type Services } from "@tinkerbell/composition";
import { createRunner } from "./runner.ts";
import { createQueries } from "./queries.ts";
import { createSchedule } from "./schedule.ts";
import { createCheckpoint } from "./checkpoint.ts";
import { createDeferral } from "./deferral.ts";
import { createRuleSchedules } from "./rule-schedules.ts";
import { createRuleQueue } from "./rule-queue.ts";
import { createInternalJobs } from "./internal-jobs.ts";
import { createFeatures } from "./features.ts";
import { createStressTest } from "./stress-test/index.ts";
import { createGenerateCommand } from "./commands/generate/index.ts";
import { createDigestCommand } from "./commands/digest.ts";
import { createReconcile } from "./personalize/reconcile.ts";
import { JobStarterToken } from "./starter.ts";
import { JobConfigWriterToken } from "@tinkerbell/ports";

// ─── Pure exports ────────────────────────────────────────────────────────────
export { CHECKPOINT_TTL_MS } from "./limits.ts";
export { JobStarterToken, type JobStarter } from "./starter.ts";
// Process-level, not per-container: the shutdown latch and the Sidequest
// engine are one per OS process however many containers exist.
export { stopSidequest, isShuttingDown } from "./runner.ts";
export { DEFERRABLE_JOBS, isDeferrable } from "./deferral.ts";
export { COMMANDS, isCommandName, type CommandName, type CommandLane } from "./commands/catalog.ts";
export { type InternalJobName, type InternalJobs } from "./internal-jobs.ts";
export { FEATURE_TEMPLATES, type FeatureTemplate, type FeatureCatalogEntry } from "./features.ts";
export { BASELINE_LABEL } from "./personalize/reconcile.ts";
export {
  stressTestConfigSchema,
  stressTestStepSchema,
  type StressTestConfig,
  type StressTestStep,
  type StressTestResult,
} from "./stress-test/index.ts";
export type { StartResult, JobCommand } from "./runner.ts";
export type { CheckpointStatus } from "./checkpoint.ts";
export type { RuleWorkReason } from "./rule-queue.ts";
export type { TestRuleResult, TestCollectionPreview } from "./commands/generate/index.ts";

/**
 * Everything the job system does, bound to one container.
 *
 * Built once per process — by `apps/server` at boot and by the Sidequest
 * worker in its own thread, from the same `buildContainer()`.
 */
export const createJobs = perDeps(function createJobs(deps: Services) {
  const generate = createGenerateCommand(deps);
  return {
    ...createRunner(deps),
    ...createQueries(deps),
    ...createSchedule(deps),
    ...createCheckpoint(deps),
    ...createDeferral(deps),
    ...createRuleSchedules(deps),
    ...createRuleQueue(deps),
    ...createInternalJobs(deps),
    ...createFeatures(deps),
    ...createStressTest(deps),
    ...createReconcile(deps),
    runSingleRule: generate.runSingleRule,
    testRule: generate.testRule,
    previewDigest: createDigestCommand(deps).previewDigest,
  };
});

export type Jobs = ReturnType<typeof createJobs>;

export const JobsToken = token<Jobs>("jobs");

/**
 * Registered here rather than in `@tinkerbell/composition` because the job
 * system sits *above* it — commands resolve `ServicesToken`, so composition
 * depending on jobs would be a real cycle. Entrypoints that run jobs pass this
 * to `buildContainer`; ones that don't (the migrator) simply don't.
 */
export function registerJobs(r: Registry): void {
  r.register(JobsToken, (c) => createJobs(c.resolve(ServicesToken)));
  // Late-bound: a cron firing is the first time this is called, long after the
  // runner and the scheduler have both been built.
  r.register(JobStarterToken, (c) => (jobId) => c.resolve(JobsToken).startJob(jobId));
  // Same late binding, for the bundle importer: it needs `updateJob`'s cron
  // validation and live reschedule, and it sits below this package.
  r.register(JobConfigWriterToken, (c) => (jobId, updates) => c.resolve(JobsToken).updateJob(jobId, updates));
}
