import { useEffect, useRef } from "react";
import styles from "#pages/Jobs/Jobs.module.css";
import type { useJobActions } from "./useJobActions";
import { isRunActive, useRunLog } from "./useRunLog";

interface Props {
  latestRun: ReturnType<typeof useJobActions>["latestRun"];
}

export default function LatestRunLogPanel({ latestRun }: Props) {
  const logRef = useRef<HTMLPreElement>(null);
  const autoScroll = useRef(true);
  const log = useRunLog(latestRun?.id, isRunActive(latestRun?.status));

  useEffect(() => {
    if (autoScroll.current && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  if (!latestRun) return null;

  const handleScroll = () => {
    if (!logRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logRef.current;
    autoScroll.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  const active = isRunActive(latestRun.status);

  return (
    <fieldset className={styles.detailSection}>
      <legend className={styles.detailSectionTitle}>
        Latest Run Log
        {active && latestRun.progress > 0 && (
          <span className={styles.runMeta}> — {Math.round(latestRun.progress * 100)}%</span>
        )}
        {latestRun.status === "cancelling" && <span className={styles.runMeta}> — cancelling…</span>}
      </legend>
      {active && latestRun.progress > 0 && (
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${Math.round(latestRun.progress * 100)}%` }} />
        </div>
      )}
      <div className={styles.logWrapper}>
        {log && (
          <button className={styles.logCopyBtn} onClick={() => navigator.clipboard.writeText(log)}>
            Copy
          </button>
        )}
        <pre ref={logRef} className={styles.logViewer} onScroll={handleScroll}>
          {log || "(no output yet)"}
        </pre>
      </div>
    </fieldset>
  );
}
