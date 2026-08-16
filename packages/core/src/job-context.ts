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
  /**
   * The `job_runs.id` this context belongs to, when a job run owns it.
   *
   * Absent for the contexts that have no run row behind them — an ad-hoc rule
   * run, a preview, the stress harness. Present so work a job does on behalf of
   * something else (a `rule_runs` row, say) can point back at the run that
   * caused it.
   */
  runId?: string;
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

export const digestJobConfigSchema = commonJobConfigSchema.extend({
  /**
   * How much history the server-wide digest covers, and — via the ledger —
   * how often it may be sent. Each subscriber's own frequency governs theirs.
   */
  frequency: z.enum(["weekly", "monthly"]).optional(),
  /**
   * Fewest new items worth sending for. A digest saying "nothing happened"
   * trains people to ignore the channel, so below this the run records
   * `skipped_empty` and sends nothing — unless something is about to be
   * deleted, which is worth a message on its own.
   */
  minAddedItems: z.number().int().min(0).optional(),
  /** Cap on the tailored list in a per-user digest. */
  userItemCap: z.number().int().min(1).max(25).optional(),
  /** Send the server-wide digest to the admin's subscribed channels. */
  includeServerDigest: z.boolean().optional(),
  /** Send per-user digests by email to portal users who asked for one. */
  includeUserDigests: z.boolean().optional(),
});
export type DigestJobConfig = z.infer<typeof digestJobConfigSchema>;
