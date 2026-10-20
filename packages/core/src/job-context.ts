import type { Scope } from "@tinkerbell/container";

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
  /**
   * The run's own container scope.
   *
   * A job run is a natural scope boundary: it has a start, an end, and its own
   * abort signal, so anything scoped to it is released when the run finishes
   * however it finished. Commands resolve their dependencies from here — which
   * is also what gives a Sidequest worker thread, with its own module graph, a
   * properly wired application instead of the no-op hooks it used to get.
   */
  scope: Scope;
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

/**
 * A `JobContext` for work that has no `job_runs` row of its own: an ad-hoc rule
 * run, a queue drain, the stress harness.
 *
 * The scope is passed rather than created. Work like this is a leaf of whatever
 * started it, so it shares that lifetime — giving it a child scope would claim
 * a disposal boundary it does not have, and nothing here registers anything
 * scoped anyway. Everything else defaults to the inert option, so a caller
 * states only the parts it actually implements.
 */
export function deriveJobContext(
  scope: Scope,
  parts: Pick<JobContext, "log"> & Partial<Omit<JobContext, "scope" | "log">>,
): JobContext {
  return {
    scope,
    progress: () => {},
    signal: new AbortController().signal,
    checkpoint: noopCheckpoint,
    ...parts,
  };
}

// The schemas moved to contracts so the admin UI can render forms from the
// same definitions the server validates with. Re-exported so command code keeps
// importing them from here.
export {
  bywJobConfigSchema,
  wtylJobConfigSchema,
  pibuJobConfigSchema,
  seasonCollectionsJobConfigSchema,
  leavingSoonJobConfigSchema,
  collectionArtJobConfigSchema,
  collectionsSweepJobConfigSchema,
  commonJobConfigSchema,
  digestJobConfigSchema,
  generateJobConfigSchema,
  overlaysJobConfigSchema,
} from "@tinkerbell/contracts";
export type {
  BywJobConfig,
  WtylJobConfig,
  PibuJobConfig,
  SeasonCollectionsJobConfig,
  LeavingSoonJobConfig,
  CollectionArtJobConfig,
  CollectionsSweepJobConfig,
  CommonJobConfig,
  DigestJobConfig,
  GenerateJobConfig,
  OverlaysJobConfig,
} from "@tinkerbell/contracts";
