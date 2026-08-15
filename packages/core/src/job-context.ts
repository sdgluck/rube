import { z } from "zod";
import { RULE_CONCURRENCY_MAX } from "@tinkerbell/contracts";

/**
 * Per-job resumable state.
 *
 * Keyed on the *job*, not the run, so a fresh run picks up what the previous
 * one abandoned — which is the whole point on a home server where container
 * restarts are routine and `generate` is the longest job in the system.
 *
 * Only the long commands (`generate`, `sync-media`) checkpoint. The rest are
 * short enough that restarting from zero costs less than the bookkeeping — that
 * is a deliberate choice, not an oversight.
 */
export interface JobCheckpoint {
  /** Returns null when there is no checkpoint, or the stored one is past its TTL. */
  read<T>(): T | null;
  write(data: unknown): void;
  clear(): void;
}

export interface JobContext {
  log: (...args: unknown[]) => void;
  progress: (current: number, total: number, message: string) => void;
  signal: AbortSignal;
  checkpoint: JobCheckpoint;
}

/**
 * Checkpoint that stores nothing. For contexts with no `job_runs` row behind
 * them — rule previews/tests, the stress test harness — where "resume the
 * previous run" is meaningless.
 */
export const noopCheckpoint: JobCheckpoint = {
  read: () => null,
  write: () => {},
  clear: () => {},
};

export const commonJobConfigSchema = z.object({
  sections: z.array(z.string()).optional(),
});
export type CommonJobConfig = z.infer<typeof commonJobConfigSchema>;

export const generateJobConfigSchema = commonJobConfigSchema.extend({
  /**
   * How many rules to run at once. Rules are independent, but they share
   * one Plex server and the external APIs behind it, so this is capped low
   * and defaults conservatively — see `RULE_CONCURRENCY_DEFAULT`.
   */
  ruleConcurrency: z.number().int().min(1).max(RULE_CONCURRENCY_MAX).optional(),
});
export type GenerateJobConfig = z.infer<typeof generateJobConfigSchema>;

export const bywJobConfigSchema = commonJobConfigSchema.extend({
  limit: z.number().int().min(1).max(50).optional(),
  mode: z.enum(["per-user", "server"]).optional(),
  users: z.array(z.string()).optional(),
  pinToHomepage: z.boolean().optional(),
  minItems: z.number().int().min(5).max(50).optional(),
  maxItems: z.number().int().min(10).max(100).optional(),
  minLibrarySize: z.number().int().min(1).optional(),
});
export type BywJobConfig = z.infer<typeof bywJobConfigSchema>;

export const collectionsSweepJobConfigSchema = commonJobConfigSchema.extend({
  /**
   * Report what would be deleted and stop. Off by default — the job's own log
   * lists every collection before it deletes anything, so the normal run is
   * already auditable after the fact.
   */
  dryRun: z.boolean().optional(),
});
export type CollectionsSweepJobConfig = z.infer<typeof collectionsSweepJobConfigSchema>;

export const collectionArtJobConfigSchema = commonJobConfigSchema.extend({
  /**
   * Restrict the run to these rules. Set by the "Generate artwork now" action
   * on a single rule; absent means every rule that has opted in, which is what
   * the scheduled run does.
   */
  ruleIds: z.array(z.string()).optional(),
  /**
   * Re-render and re-upload even where the input hash says nothing changed.
   * For the case the ledger can't see: someone replaced the poster in Plex by
   * hand and wants Tinkerbell's back.
   */
  force: z.boolean().optional(),
});
export type CollectionArtJobConfig = z.infer<typeof collectionArtJobConfigSchema>;

export const overlaysJobConfigSchema = commonJobConfigSchema.extend({
  mode: z.enum(["apply", "remove"]).optional(),
});
export type OverlaysJobConfig = z.infer<typeof overlaysJobConfigSchema>;
