import { useJobActions } from "./shared/useJobActions";
import JobPageShell from "./shared/JobPageShell";
import ConfigPanel from "./shared/ConfigPanel";
import RunHistoryPanel from "./shared/RunHistoryPanel";
import LatestRunLogPanel from "./shared/LatestRunLogPanel";
import ScheduleRow from "./shared/rows/ScheduleRow";
import EnabledRow from "./shared/rows/EnabledRow";
import styles from "#pages/Jobs.module.css";
import type { JobPageProps } from "./types";

export default function PurgeRunsJob({ job }: JobPageProps) {
  const actions = useJobActions(job);

  return (
    <JobPageShell job={job} actions={actions}>
      <div className={styles.jobDetailColumns}>
        <ConfigPanel>
          <ScheduleRow jobId={job.id} schedule={job.schedule} />
          <EnabledRow jobId={job.id} enabled={!!job.enabled} />
        </ConfigPanel>
        <RunHistoryPanel runsQuery={actions.runsQuery} />
      </div>
      <LatestRunLogPanel latestRun={actions.latestRun} />
    </JobPageShell>
  );
}
