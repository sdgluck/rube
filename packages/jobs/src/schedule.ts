/**
 * Cron scheduling for jobs. Pulled out of runner.ts so the lifecycle
 * code doesn't share a file with cron plumbing (GET-124).
 *
 * The cycle with runner.ts is broken by dependency injection: the cron
 * callback needs to call `startJob`, but `startJob` lives in runner.ts
 * which would otherwise want to import `scheduleCron` from here. The
 * runner calls `initSchedule(startJob)` once at boot; everything downstream
 * (schedule.scheduleCron, schedule.startCronSchedules) reaches startJob
 * through the closed-over reference.
 */
import { and, eq, ne } from "drizzle-orm";
import { Cron } from "croner";
import { db, jobs } from "@tinkerbell/db";

type ScheduledJob = { id: string; name: string; enabled: number; schedule: string };
type JobStarter = (jobId: string) => Promise<unknown>;

let startJob: JobStarter | null = null;

/**
 * Wire the cron callback. Called once by `initJobs` before any cron
 * schedule fires. After this, `scheduleCron` is safe to call.
 */
export function initSchedule(starter: JobStarter): void {
  startJob = starter;
}

/**
 * Map of jobId → active Cron. Exported so feature uninstall can stop a
 * cron without re-reading from the DB.
 */
export const cronJobs = new Map<string, Cron>();

export function scheduleCron(job: ScheduledJob): void {
  const existing = cronJobs.get(job.id);
  if (existing) {
    existing.stop();
    cronJobs.delete(job.id);
  }

  if (!job.enabled || !job.schedule) return;

  const cron = new Cron(job.schedule, () => {
    console.log(`[jobs] Cron triggered: ${job.name}`);
    if (!startJob) {
      console.error(`[jobs] Cron fired for ${job.name} before initSchedule() — dropping`);
      return;
    }
    startJob(job.id).catch((err) => console.error(`[jobs] Failed to start ${job.name}:`, err));
  });
  cronJobs.set(job.id, cron);
}

export function startCronSchedules(): void {
  const enabledJobs = db
    .select()
    .from(jobs)
    .where(and(eq(jobs.enabled, 1), ne(jobs.schedule, "")))
    .all();
  for (const job of enabledJobs) {
    scheduleCron(job);
  }
  console.log(`[jobs] Started ${enabledJobs.length} cron schedule(s)`);
}
