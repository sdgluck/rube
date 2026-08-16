import styles from "#pages/Jobs/Jobs.module.css";
import type { useJobActions } from "./useJobActions";
import { isRunActive, useRunLog } from "./useRunLog";
import CardSection from "#components/CardSection";
import RunLog from "#components/RunLog";

interface Props {
  latestRun: ReturnType<typeof useJobActions>["latestRun"];
}

export default function LatestRunLogPanel({ latestRun }: Props) {
  const log = useRunLog(latestRun?.id, isRunActive(latestRun?.status));

  if (!latestRun) return null;

  const active = isRunActive(latestRun.status);

  return (
    <CardSection
      className={styles.detailSection}
      titleClassName={styles.detailSectionTitle}
      title={
        <>
          Latest Run Log
          {active && latestRun.progress > 0 && (
            <span className={styles.runMeta}> — {Math.round(latestRun.progress * 100)}%</span>
          )}
          {latestRun.status === "cancelling" && <span className={styles.runMeta}> — cancelling…</span>}
        </>
      }
    >
      {active && latestRun.progress > 0 && (
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${Math.round(latestRun.progress * 100)}%` }} />
        </div>
      )}
      <RunLog log={log} variant="compact" ariaLabel="Latest run log" />
    </CardSection>
  );
}
