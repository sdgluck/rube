import { useJobActions } from "#pages/Jobs/shared/useJobActions";
import JobPageShell from "#pages/Jobs/shared/JobPageShell";
import JobSettingsPanel from "#pages/Jobs/shared/JobSettingsPanel";
import RunHistoryPanel from "#pages/Jobs/shared/RunHistoryPanel";
import LatestRunLogPanel from "#pages/Jobs/shared/LatestRunLogPanel";
import GeneratedCollectionsPanel from "#pages/Jobs/shared/GeneratedCollectionsPanel";
import styles from "#pages/Jobs/Jobs.module.css";
import type { JobPageProps } from "#pages/Jobs/types";
import SeasonsPanel from "./SeasonsPanel";

export default function SeasonCollectionsJob({ job }: JobPageProps) {
  const actions = useJobActions(job);
  return (
    <JobPageShell job={job} actions={actions}>
      <div className={styles.jobDetailColumns}>
        <JobSettingsPanel job={job} />
        <RunHistoryPanel runsQuery={actions.runsQuery} command={job.command} />
      </div>
      <SeasonsPanel job={job} />
      <GeneratedCollectionsPanel jobId="season-collections" />
      <LatestRunLogPanel latestRun={actions.latestRun} />
    </JobPageShell>
  );
}
