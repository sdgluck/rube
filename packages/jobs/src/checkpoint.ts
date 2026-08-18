import { perDeps } from "@tinkerbell/container";
import { type Services } from "@tinkerbell/composition";
/**
 * `job_checkpoints`-backed implementation of `JobContext.checkpoint`.
 *
 * Only the long commands use this — `generate` (per rule) and `sync-media`
 * (per Plex section). Everything else finishes fast enough that restarting
 * from zero is cheaper than the bookkeeping, and the *deliberate* absence of a
 * checkpoint there is not an oversight.
 *
 * Two rules keep a stale checkpoint from silently skipping work:
 *   1. reads past `CHECKPOINT_TTL_MS` return null (and delete the row), and
 *   2. commands clear their checkpoint on successful completion.
 */
import { eq } from "drizzle-orm";
import { jobCheckpoints } from "@tinkerbell/db";
import { createLogger, errorMessage, type JobCheckpoint } from "@tinkerbell/core";
import { CHECKPOINT_TTL_MS } from "./limits.ts";

const log = createLogger("jobs");

export interface CheckpointStatus {
  jobId: string;
  updatedAt: number;
  /** Past the TTL, so the next run will discard it rather than resume from it. */
  expired: boolean;
  expiresAt: number;
}

export const createCheckpoint = perDeps(function createCheckpoint(deps: Pick<Services, "db">) {
  const { db } = deps;

  function createCheckpoint(jobId: string): JobCheckpoint {
    return {
      read<T>(): T | null {
        try {
          const row = db.select().from(jobCheckpoints).where(eq(jobCheckpoints.jobId, jobId)).get();
          if (!row) return null;
          if (Date.now() - row.updatedAt > CHECKPOINT_TTL_MS) {
            db.delete(jobCheckpoints).where(eq(jobCheckpoints.jobId, jobId)).run();
            log.info("discarded expired checkpoint", { jobId, ageMs: Date.now() - row.updatedAt });
            return null;
          }
          return row.data as T;
        } catch (err) {
          // A checkpoint is an optimisation. Never let reading one fail a run.
          log.warn("failed to read checkpoint", { jobId, err: errorMessage(err) });
          return null;
        }
      },

      write(data: unknown): void {
        try {
          db.insert(jobCheckpoints)
            .values({ jobId, data, updatedAt: Date.now() })
            .onConflictDoUpdate({ target: jobCheckpoints.jobId, set: { data, updatedAt: Date.now() } })
            .run();
        } catch (err) {
          log.warn("failed to write checkpoint", { jobId, err: errorMessage(err) });
        }
      },

      clear(): void {
        try {
          db.delete(jobCheckpoints).where(eq(jobCheckpoints.jobId, jobId)).run();
        } catch (err) {
          log.warn("failed to clear checkpoint", { jobId, err: errorMessage(err) });
        }
      },
    };
  }

  /**
   * Whether a job is currently carrying resumable state, for the UI.
   *
   * Read-only and deliberately non-destructive, unlike `read()`, which deletes an
   * expired row as a side effect. Somebody looking at a job's page should not
   * silently change what its next run will do.
   */
  function checkpointStatus(jobId: string): CheckpointStatus | null {
    const row = db.select().from(jobCheckpoints).where(eq(jobCheckpoints.jobId, jobId)).get();
    if (!row) return null;
    return {
      jobId,
      updatedAt: row.updatedAt,
      expired: Date.now() - row.updatedAt > CHECKPOINT_TTL_MS,
      expiresAt: row.updatedAt + CHECKPOINT_TTL_MS,
    };
  }

  /** Throw away resumable state, so the next run starts from scratch. */
  function discardCheckpoint(jobId: string): boolean {
    return db.delete(jobCheckpoints).where(eq(jobCheckpoints.jobId, jobId)).run().changes > 0;
  }

  return { createCheckpoint, checkpointStatus, discardCheckpoint };
});
