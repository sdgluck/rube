import { useEffect, useRef } from "react";
import styles from "#pages/Jobs/Jobs.module.css";
import type { useJobActions } from "./useJobActions";

interface Props {
  latestRun: ReturnType<typeof useJobActions>["latestRun"];
}

export default function LatestRunLogPanel({ latestRun }: Props) {
  const logRef = useRef<HTMLPreElement>(null);
  const autoScroll = useRef(true);

  useEffect(() => {
    if (autoScroll.current && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [latestRun?.log]);

  if (!latestRun) return null;

  const handleScroll = () => {
    if (!logRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logRef.current;
    autoScroll.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  return (
    <fieldset className={styles.detailSection}>
      <legend className={styles.detailSectionTitle}>
        Latest Run Log
        {latestRun.status === "running" && latestRun.progress > 0 && (
          <span className={styles.runMeta}> — {Math.round(latestRun.progress * 100)}%</span>
        )}
      </legend>
      {latestRun.status === "running" && latestRun.progress > 0 && (
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${Math.round(latestRun.progress * 100)}%` }} />
        </div>
      )}
      <div className={styles.logWrapper}>
        {latestRun.log && (
          <button className={styles.logCopyBtn} onClick={() => navigator.clipboard.writeText(latestRun.log)}>
            Copy
          </button>
        )}
        <pre ref={logRef} className={styles.logViewer} onScroll={handleScroll}>
          {latestRun.log || "(no output yet)"}
        </pre>
      </div>
    </fieldset>
  );
}
