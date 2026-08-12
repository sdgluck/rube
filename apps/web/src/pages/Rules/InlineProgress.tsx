import { useEffect, useRef, useState } from "react";
import { trpc } from "#/trpc";
import styles from "./Rules.module.css";
import { formatDuration } from "#/format";

interface InlineProgressProps {
  ruleId: string;
  phase: "test" | "run";
}

export default function InlineProgress({ ruleId, phase }: InlineProgressProps) {
  const progressQuery = trpc.rules.progress.useQuery({ id: ruleId }, { refetchInterval: 500, enabled: true });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const data = progressQuery.data;
  const logs = data?.recentLogs ?? [];

  /**
   * Follow the tail as lines arrive, but stop the moment the user scrolls up —
   * otherwise the 500ms poll yanks them back to the bottom and reading
   * anything that already scrolled past becomes impossible. Re-arms when they
   * scroll back to the bottom themselves.
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
  }, [logs.length]);

  const elapsed = data ? now - data.startedAt : 0;
  const pct = data && data.total > 0 ? Math.min(100, Math.round((data.current / data.total) * 100)) : 0;
  const indeterminate = !data || data.total === 0 || data.current === 0;

  return (
    <div>
      <div className={styles.detailHeader}>
        <span className={styles.detailTitle}>{phase === "test" ? "Testing" : "Running"}…</span>
        <span className={styles.detailMeta}>
          {elapsed > 0 ? `${formatDuration(elapsed)} elapsed` : ""}
          {data && data.total > 0 ? ` · step ${data.current}/${data.total}` : ""}
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
      {logs.length > 0 && (
        <pre
          ref={logRef}
          className={styles.logTail}
          onScroll={handleLogScroll}
          tabIndex={0}
          role="log"
          aria-label={phase === "test" ? "Test log" : "Run log"}
        >
          {logs.join("\n")}
        </pre>
      )}
    </div>
  );
}
