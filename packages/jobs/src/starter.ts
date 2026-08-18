/**
 * Starting a job, as a port.
 *
 * `schedule.ts` and `runner.ts` need each other: the runner registers cron
 * schedules, and a cron that fires has to start a job. That was broken with a
 * module-level `let` and an `initSchedule(starter)` setter, read back as
 * `startJob?.(…)` — so a process that never called the setter had every
 * scheduled run silently do nothing.
 *
 * As a token the binding is declared once, in `registerJobs`, and resolved when
 * a cron fires rather than when the schedule is built — which is what keeps the
 * cycle from recursing.
 */
import { token } from "@tinkerbell/container";

export type JobStarter = (jobId: string) => Promise<unknown>;

export const JobStarterToken = token<JobStarter>("jobs.starter");
