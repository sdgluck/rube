import { useMemo } from "react";
import { trpc } from "#/trpc";
import { describeCron } from "#/utils";
import { cronNextRuns, formatFireTime } from "#lib/cron.ts";
import styles from "./CronPreview.module.css";

interface CronPreviewProps {
  expr: string;
  /** How many fire times to list. */
  count?: number;
  /** Overrides the configured schedule zone — for previewing a hypothetical. */
  timezone?: string;
  className?: string;
}

/**
 * What a cron expression will actually do, under the field that sets it.
 *
 * Cron is the one input in the app where a typo is both easy and silent: a
 * wrong-but-valid expression schedules something for a time nobody intended
 * and reports no error at any point. Three fire times make that visible while
 * the field still has focus, and they are rendered in the *schedule's*
 * timezone rather than the browser's, because the gap between those two is
 * the second-most common way to get this wrong.
 */
export default function CronPreview({ expr, count = 3, timezone, className }: CronPreviewProps) {
  const effectiveQuery = trpc.config.effectiveTimezone.useQuery(undefined, { staleTime: 5 * 60_000 });
  const zone = timezone ?? effectiveQuery.data?.timezone;

  const { error, next } = useMemo(() => cronNextRuns(expr, zone, count), [expr, zone, count]);

  if (!expr.trim()) return null;

  if (error || next.length === 0) {
    return (
      <div className={`${styles.preview} ${styles.error} ${className ?? ""}`} role="alert">
        {error ?? "That expression never fires again."}
      </div>
    );
  }

  const described = describeCron(expr);
  return (
    <div className={`${styles.preview} ${className ?? ""}`}>
      {described && described !== expr.trim() && <span className={styles.described}>{described}. </span>}
      <span>
        Next {next.map((d) => formatFireTime(d, zone)).join(" · ")}
        {zone ? ` (${zone})` : ""}
      </span>
    </div>
  );
}
