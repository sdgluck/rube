import { useEffect, useState } from "react";
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
      {data && data.recentLogs.length > 0 && (
        <pre className={styles.logTail}>{data.recentLogs.slice(-8).join("\n")}</pre>
      )}
    </div>
  );
}
