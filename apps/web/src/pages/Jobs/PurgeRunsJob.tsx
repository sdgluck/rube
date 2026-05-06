import { useJobActions } from "./shared/useJobActions";
import JobPageShell from "./shared/JobPageShell";
import ConfigPanel from "./shared/ConfigPanel";
import RunHistoryPanel from "./shared/RunHistoryPanel";
import LatestRunLogPanel from "./shared/LatestRunLogPanel";
import JobConfigRows from "./shared/JobConfigRows";
import styles from "#pages/Jobs/Jobs.module.css";
import type { JobPageProps } from "./types";

export default function PurgeRunsJob({ job }: JobPageProps) {
  const actions = useJobActions(job);

  return (
    <JobPageShell job={job} actions={actions}>
      <div className={styles.jobDetailColumns}>
        <ConfigPanel>
          <JobConfigRows job={job} />
        </ConfigPanel>
        <RunHistoryPanel runsQuery={actions.runsQuery} />
      </div>
      <LatestRunLogPanel latestRun={actions.latestRun} />
    </JobPageShell>
  );
}
