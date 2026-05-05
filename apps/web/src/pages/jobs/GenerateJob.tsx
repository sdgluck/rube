import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { trpc } from "../../trpc";
import { useJobActions } from "./shared/useJobActions";
import JobPageShell from "./shared/JobPageShell";
import ConfigPanel from "./shared/ConfigPanel";
import RunHistoryPanel from "./shared/RunHistoryPanel";
import LatestRunLogPanel from "./shared/LatestRunLogPanel";
import ScheduleRow from "./shared/rows/ScheduleRow";
import EnabledRow from "./shared/rows/EnabledRow";
import SectionsRow from "./shared/rows/SectionsRow";
import styles from "../Jobs.module.css";
import type { JobPageProps } from "./types";

export default function GenerateJob({ job }: JobPageProps) {
  const utils = trpc.useUtils();
  const actions = useJobActions(job);
  const [sections, setSections] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const cfg = (job.config ?? {}) as { sections?: string[] };
    setSections(cfg.sections ?? []);
    setDirty(false);
  }, [job.config]);

  const updateMutation = trpc.jobs.update.useMutation({
    onSuccess: () => utils.jobs.list.invalidate(),
  });

  const handleSave = () => {
    const config: Record<string, unknown> = {};
    if (sections.length > 0) config.sections = sections;
    updateMutation.mutate({ jobId: job.id, config }, { onSuccess: () => setDirty(false) });
  };

  return (
    <JobPageShell job={job} actions={actions}>
      <div className={styles.jobDetailColumns}>
        <ConfigPanel save={{ dirty, onSave: handleSave }}>
          <ScheduleRow jobId={job.id} schedule={job.schedule} />
          <EnabledRow jobId={job.id} enabled={!!job.enabled} />
          <SectionsRow
            selected={sections}
            onChange={(next) => {
              setSections(next);
              setDirty(true);
            }}
          />
          <tr>
            <td>Rules</td>
            <td colSpan={2}>
              <Link to="/rules">Manage rules &rarr;</Link>
            </td>
          </tr>
        </ConfigPanel>
        <RunHistoryPanel runsQuery={actions.runsQuery} />
      </div>
      <LatestRunLogPanel latestRun={actions.latestRun} />
    </JobPageShell>
  );
}
