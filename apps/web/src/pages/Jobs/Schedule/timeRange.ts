import { parseClock } from "@tinkerbell/contracts";

/**
 * What a `from`–`to` clock window actually covers, as "→ 07:00 next day · 8 h".
 *
 * Quiet hours and the maintenance window both treat an end before the start as
 * spanning midnight. Each used to explain that rule in a sentence under the
 * fields; showing the computed end and length says it without asking anyone to
 * read the rule, and makes a reversed pair obvious at a glance. Equal times
 * are an empty window to the server (`isWithinClockWindow`), so they say so
 * rather than claiming 24 hours.
 */
export function describeTimeRange(from: string, to: string): string | null {
  const start = parseClock(from);
  const end = parseClock(to);
  if (start == null || end == null) return null;
  if (start === end) return "Start and end match — never active";
  const length = end > start ? end - start : end + 1440 - start;
  const nextDay = end < start ? " next day" : "";
  return `→ ${to.trim()}${nextDay} · ${formatLength(length)}`;
}

function formatLength(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
