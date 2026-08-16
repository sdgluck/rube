import RelativeTime from "#components/RelativeTime";
import Spinner from "#components/Spinner";
import styles from "./Rules.module.css";
import type { RuleRow } from "./types";

interface RuleStatusCellProps {
  rule: RuleRow;
  isTesting: boolean;
  isRunning: boolean;
  /** 0–1 from the run's own row; 0 while it has nothing to report yet. */
  runProgress?: number;
  /** Set for cleanup rules — a collection count says nothing about them. */
  cleanup?: { queued: number; actioned: number };
}

/**
 * Read-only status text. Was previously a button that toggled an inline
 * popup with logs/details; that affordance was removed — logs are surfaced
 * automatically while a run/test is in-flight, and the result preview
 * opens automatically on completion.
 */
export default function StatusCell({ rule, isTesting, isRunning, runProgress = 0, cleanup }: RuleStatusCellProps) {
  // A percentage only once there is one: a run reports 0 until it knows how
  // much work it has, and "Running… 0%" reads like something is stuck.
  const pct = runProgress > 0 ? ` ${Math.round(runProgress * 100)}%` : "";
  if (isRunning) {
    return (
      <span className={`${styles.statusInline} ${styles.statusBusy}`}>
        <Spinner size="xs" />
        Running…{pct}
      </span>
    );
  }
  if (isTesting) {
    return (
      <span className={`${styles.statusInline} ${styles.statusBusy}`}>
        <Spinner size="xs" />
        Testing…{pct}
      </span>
    );
  }

  // A cleanup rule's ending isn't a collection, so "ok" and a collection count
  // are both the wrong thing to report. What matters is how much is waiting.
  if (cleanup) {
    return (
      <span className={styles.statusInline}>
        <span className={cleanup.queued > 0 ? styles.statusOk : styles.statusIdle}>{cleanup.queued} queued</span>
        {cleanup.actioned > 0 && <span className={styles.statusIdle}> / {cleanup.actioned} actioned</span>}
      </span>
    );
  }

  const runAt = rule.lastRunAt ?? 0;
  const testAt = rule.lastTestAt ?? 0;
  const useRun = runAt >= testAt;
  const stamp = useRun ? rule.lastRunAt : rule.lastTestAt;
  const status = useRun ? rule.lastRunStatus : rule.lastTestStatus;
  const error = useRun ? rule.lastRunError : rule.lastTestError;
  const label = useRun ? "Run" : "Test";

  if (!stamp) {
    return <span className={styles.statusIdle}>—</span>;
  }

  const summary = useRun
    ? rule.lastRunStatus === "ok"
      ? "ok"
      : rule.lastRunStatus
    : rule.lastTestStatus === "ok"
      ? `${rule.lastTestCollectionCount ?? 0} collection${rule.lastTestCollectionCount === 1 ? "" : "s"}`
      : rule.lastTestStatus;

  let cls = styles.statusOk;
  if (status === "error") cls = styles.statusError;
  else if (status === "cancelled") cls = styles.statusCancelled;

  return (
    <span className={`${styles.statusInline} ${cls}`} title={error || undefined}>
      {label} <RelativeTime timestamp={stamp} /> · {summary}
    </span>
  );
}
