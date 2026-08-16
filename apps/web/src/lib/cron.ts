import { Cron } from "croner";

export interface CronRuns {
  /** A parse failure, phrased for someone who typed the expression. */
  error: string | null;
  /** Fire times, soonest first. Empty when the expression never fires again. */
  next: Date[];
}

/**
 * The next few fire times of a cron expression, in a given zone.
 *
 * Croner is already the scheduler on the server, so asking the same library
 * the same question is the only way a preview can be trusted — a hand-rolled
 * parser that disagreed with the runner would be worse than no preview at all.
 */
export function cronNextRuns(expr: string, timezone?: string, count = 3): CronRuns {
  const trimmed = expr.trim();
  if (!trimmed) return { error: null, next: [] };
  try {
    const cron = new Cron(trimmed, timezone ? { timezone } : {});
    const next: Date[] = [];
    let from: Date | undefined;
    for (let i = 0; i < count; i++) {
      const run: Date | null = from ? cron.nextRun(from) : cron.nextRun();
      if (!run) break;
      next.push(run);
      from = run;
    }
    return { error: null, next };
  } catch (err) {
    return { error: (err as Error).message || "Not a valid cron expression", next: [] };
  }
}

/** `Sat 3 Jan, 03:00` in the schedule's zone, not the viewer's. */
export function formatFireTime(date: Date, timezone?: string): string {
  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    ...(timezone ? { timeZone: timezone } : {}),
  });
}

/**
 * Groups of jobs whose next run lands in the same minute.
 *
 * Worth saying out loud because queues run one at a time: four jobs all set to
 * `0 3 * * *` do not run at 3am, they run at 3am, 3:04, 3:19 and whenever the
 * slow one ahead of them finishes. That is invisible from a list of next-run
 * times, each of which looks perfectly correct on its own.
 */
export function findScheduleCollisions(upcoming: { name: string; nextRun: number }[]): string[][] {
  const byMinute = new Map<number, string[]>();
  for (const item of upcoming) {
    const minute = Math.floor(item.nextRun / 60_000);
    byMinute.set(minute, [...(byMinute.get(minute) ?? []), item.name]);
  }
  return [...byMinute.values()].filter((names) => names.length > 1);
}
