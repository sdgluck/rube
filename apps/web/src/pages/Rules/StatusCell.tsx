import RelativeTime from "#components/RelativeTime";
import Spinner from "#components/Spinner";
import styles from "./Rules.module.css";
import type { RuleRow } from "./types";

interface RuleStatusCellProps {
  rule: RuleRow;
  isTesting: boolean;
  isRunning: boolean;
}

/**
 * Read-only status text. Was previously a button that toggled an inline
 * popup with logs/details; that affordance was removed — logs are surfaced
 * automatically while a run/test is in-flight, and the result preview
 * opens automatically on completion.
 */
export default function StatusCell({ rule, isTesting, isRunning }: RuleStatusCellProps) {
  if (isRunning) {
    return (
      <span className={`${styles.statusInline} ${styles.statusBusy}`}>
        <Spinner size="xs" />
        Running…
      </span>
    );
  }
  if (isTesting) {
    return (
      <span className={`${styles.statusInline} ${styles.statusBusy}`}>
        <Spinner size="xs" />
        Testing…
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
