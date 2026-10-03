import { useJobActions } from "#pages/Jobs/shared/useJobActions";
import JobPageShell from "#pages/Jobs/shared/JobPageShell";
import JobSettingsPanel from "#pages/Jobs/shared/JobSettingsPanel";
import RunHistoryPanel from "#pages/Jobs/shared/RunHistoryPanel";
import LatestRunLogPanel from "#pages/Jobs/shared/LatestRunLogPanel";
import styles from "#pages/Jobs/Jobs.module.css";
import type { JobPageProps } from "#pages/Jobs/types";
import GeneratedCollectionsPanel from "./GeneratedCollectionsPanel";

export default function BecauseYouWatchedJob({ job }: JobPageProps) {
  const actions = useJobActions(job);
  return (
    <JobPageShell job={job} actions={actions}>
      <div className={styles.jobDetailColumns}>
        <JobSettingsPanel job={job} />
        <RunHistoryPanel runsQuery={actions.runsQuery} command={job.command} />
      </div>
      <GeneratedCollectionsPanel />
      <LatestRunLogPanel latestRun={actions.latestRun} />
    </JobPageShell>
  );
}
