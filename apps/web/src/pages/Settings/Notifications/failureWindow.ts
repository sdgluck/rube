/**
 * The unit beside "Announce a failure after N": "failed checks (≈N min)".
 *
 * A count of checks only means something once you know how often a check
 * runs. The interval is read from the healthcheck job's own schedule rather
 * than assumed, because that schedule is editable on the Jobs page and a
 * hard-coded "every minute" would quietly go wrong the day someone slows it.
 * A schedule that isn't a plain every-K-minutes shape gets no estimate.
 */
export function checkIntervalMinutes(schedule: string | undefined): number | null {
  if (!schedule) return null;
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5 || parts.slice(1).some((p) => p !== "*")) return null;
  if (parts[0] === "*") return 1;
  const step = /^\*\/(\d+)$/.exec(parts[0]);
  return step ? Number(step[1]) : null;
}

export function failedChecksSuffix(threshold: number, schedule: string | undefined): string {
  const noun = threshold === 1 ? "failed check" : "failed checks";
  const interval = checkIntervalMinutes(schedule);
  return interval == null ? noun : `${noun} (≈${threshold * interval} min)`;
}
