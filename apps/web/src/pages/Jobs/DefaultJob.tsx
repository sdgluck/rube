import { useJobActions } from "./shared/useJobActions";
import JobPageShell from "./shared/JobPageShell";
import JobSettingsPanel from "./shared/JobSettingsPanel";
import RunHistoryPanel from "./shared/RunHistoryPanel";
import LatestRunLogPanel from "./shared/LatestRunLogPanel";
import styles from "#pages/Jobs/Jobs.module.css";
import type { JobPageProps } from "./types";

export default function DefaultJob({ job }: JobPageProps) {
  const actions = useJobActions(job);
  return (
    <JobPageShell job={job} actions={actions}>
      <div className={styles.jobDetailColumns}>
        <JobSettingsPanel job={job} />
        <RunHistoryPanel runsQuery={actions.runsQuery} />
      </div>
      <LatestRunLogPanel latestRun={actions.latestRun} />
    </JobPageShell>
  );
}
