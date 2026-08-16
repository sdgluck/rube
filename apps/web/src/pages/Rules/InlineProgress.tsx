import { useEffect, useState } from "react";
import { trpc } from "#/trpc";
import RunLog from "#components/RunLog";
import { fetchRuleRunLog, isRunActive, useRunLog } from "#pages/Jobs/shared/useRunLog";
import styles from "./Rules.module.css";
import { formatDuration } from "#/format";

interface InlineProgressProps {
  /** The `rule_runs` row to follow. */
  runId: string;
  phase: "test" | "run";
}

/**
 * The live view of one rule run, read from its row rather than from whatever
 * this tab happens to remember.
 *
 * That distinction is the whole point: reopening the row — in this tab, another
 * tab, or after a reload — re-attaches to the same run with its log so far,
 * instead of showing an empty pane for work that is plainly still happening.
 */
export default function InlineProgress({ runId, phase }: InlineProgressProps) {
  const runQuery = trpc.rules.runDetail.useQuery(
    { runId },
    // Stop polling the moment the run ends: a finished row never changes again.
    { refetchInterval: (query) => (isRunActive(query.state.data?.status ?? undefined) ? 1000 : false) },
  );
  const data = runQuery.data;
  const log = useRunLog(runId, isRunActive(data?.status ?? undefined), fetchRuleRunLog);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const elapsed = data ? now - data.startedAt : 0;
  const pct = data ? Math.min(100, Math.round(data.progress * 100)) : 0;
  const queued = data?.status === "queued";
  const indeterminate = !data || queued || pct === 0;

  return (
    <div>
      <div className={styles.detailHeader}>
        <span className={styles.detailTitle}>{queued ? "Queued" : phase === "test" ? "Testing" : "Running"}…</span>
        <span className={styles.detailMeta}>
          {elapsed > 0 ? `${formatDuration(elapsed)} elapsed` : ""}
          {pct > 0 ? ` · ${pct}%` : ""}
        </span>
      </div>
      <div className={styles.progressBar}>
        {indeterminate ? (
          <div className={styles.progressBarIndeterminate} />
        ) : (
          <div className={styles.progressBarFill} style={{ width: `${pct}%` }} />
        )}
      </div>
      <div className={styles.progressMessage}>{data?.message || "Starting…"}</div>
      {log.length > 0 && (
        <RunLog
          log={log}
          variant="compact"
          ariaLabel={phase === "test" ? "Test log" : "Run log"}
          className={styles.inlineLog}
        />
      )}
    </div>
  );
}
