import { useEffect, useRef, useState } from "react";
import { trpc } from "#/trpc";
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

  /**
   * Follow the tail as lines arrive, but stop the moment the user scrolls up —
   * otherwise the poll yanks them back to the bottom and reading anything that
   * already scrolled past becomes impossible. Re-arms when they scroll back to
   * the bottom themselves.
   */
  const logRef = useRef<HTMLPreElement>(null);
  const pinnedToBottom = useRef(true);

  const handleLogScroll = () => {
    const el = logRef.current;
    if (!el) return;
    // A couple of px of slack: fractional scroll heights mean an element the
    // user has scrolled fully down rarely lands on an exact equality.
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 4;
  };

  useEffect(() => {
    const el = logRef.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [log]);

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
        <pre
          ref={logRef}
          className={styles.logTail}
          onScroll={handleLogScroll}
          tabIndex={0}
          role="log"
          aria-label={phase === "test" ? "Test log" : "Run log"}
        >
          {log}
        </pre>
      )}
    </div>
  );
}
