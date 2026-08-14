import { useState } from "react";

/**
 * Periods offered by the playback-history panels.
 *
 * Mirrors the `periodSchema` union in `stats.router.ts` — the server validates
 * these, so a value added here without adding it there is rejected at runtime.
 * `0` means all time.
 */
export const PERIODS = [
  { days: 7 as const, label: "7d" },
  { days: 30 as const, label: "30d" },
  { days: 90 as const, label: "90d" },
  { days: 0 as const, label: "All" },
];

export type PeriodDays = (typeof PERIODS)[number]["days"];

export function usePeriod(initial: PeriodDays = 7) {
  const [periodDays, setPeriodDays] = useState<PeriodDays>(initial);
  const label = PERIODS.find((p) => p.days === periodDays)?.label ?? "7d";
  return { periodDays, setPeriodDays, label };
}
