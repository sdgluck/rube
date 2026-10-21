/**
 * Which window a digest covers.
 *
 * Periods are half-open — `[since, until)` — and aligned to the start of a
 * day in the server's configured timezone rather than to "now minus seven
 * days". Alignment is what makes the ledger's uniqueness meaningful: two runs
 * on the same Monday must produce the same `periodStart`, or the second one
 * claims a new row and sends a second digest.
 */
import { DAY_MS, type ConfigStore } from "@rube/core";

export type DigestFrequency = "weekly" | "monthly";

export interface DigestPeriod {
  since: number;
  until: number;
}

export interface PeriodDeps {
  config: ConfigStore;
}
export function createPeriod(deps: PeriodDeps) {
  const { getConfig } = deps.config;

  /**
   * Midnight at the start of `at`'s day, in the configured timezone.
   *
   * Done through `Intl` rather than `setHours`, which would use the container's
   * clock — the same reason `global_timezone` exists for cron schedules. An
   * unset or unrecognised zone falls back to the host's, which is what the
   * scheduler does too.
   */
  function startOfDay(at: number, timezone = getConfig("global_timezone")): number {
    const zone = timezone && timezone.trim() !== "" ? timezone : undefined;
    let parts;
    try {
      parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(at));
    } catch {
      // Unknown zone. `schedulerTimezone` re-checks before use for the same
      // reason: one bad config value must not take a feature down.
      return startOfDay(at, "");
    }

    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const secondsIntoDay = get("hour") * 3600 + get("minute") * 60 + get("second");
    // Truncating to the second first keeps the result on a second boundary even
    // when `at` carries milliseconds.
    return at - (at % 1000) - secondsIntoDay * 1000;
  }

  /**
   * The period a run at `now` should cover: the whole of the last 7 (or 30)
   * days, ending at the start of today.
   *
   * Ending at midnight rather than at `now` means a Monday-morning run reports
   * a complete Sunday, and means two runs the same Monday agree on the window.
   */
  function periodFor(frequency: DigestFrequency, now: number = Date.now()): DigestPeriod {
    const until = startOfDay(now);
    const days = frequency === "monthly" ? 30 : 7;
    return { since: until - days * DAY_MS, until };
  }

  return { startOfDay, periodFor };
}
