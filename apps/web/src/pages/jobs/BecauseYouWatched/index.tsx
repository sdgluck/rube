import { useEffect, useState } from "react";
import { trpc } from "#/trpc";
import { useJobActions } from "#pages/jobs/shared/useJobActions";
import JobPageShell from "#pages/jobs/shared/JobPageShell";
import ConfigPanel from "#pages/jobs/shared/ConfigPanel";
import RunHistoryPanel from "#pages/jobs/shared/RunHistoryPanel";
import LatestRunLogPanel from "#pages/jobs/shared/LatestRunLogPanel";
import ScheduleRow from "#pages/jobs/shared/rows/ScheduleRow";
import EnabledRow from "#pages/jobs/shared/rows/EnabledRow";
import SectionsRow from "#pages/jobs/shared/rows/SectionsRow";
import styles from "#pages/Jobs.module.css";
import type { JobPageProps } from "#pages/jobs/types";
import BywConfigRows, { type BywFormState } from "./ConfigRows";
import GeneratedCollectionsPanel from "./GeneratedCollectionsPanel";

const DEFAULTS: BywFormState = {
  limit: 10,
  mode: "per-user",
  users: "",
  pin: true,
  minItems: 10,
  maxItems: 30,
  minLib: 15,
};

export default function BecauseYouWatchedJob({ job }: JobPageProps) {
  const utils = trpc.useUtils();
  const actions = useJobActions(job);
  const [sections, setSections] = useState<string[]>([]);
  const [form, setForm] = useState<BywFormState>(DEFAULTS);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const cfg = (job.config ?? {}) as {
      sections?: string[];
      limit?: number;
      mode?: "per-user" | "server";
      users?: string[];
      pinToHomepage?: boolean;
      minItems?: number;
      maxItems?: number;
      minLibrarySize?: number;
    };
    setSections(cfg.sections ?? []);
    setForm({
      limit: cfg.limit ?? DEFAULTS.limit,
      mode: cfg.mode ?? DEFAULTS.mode,
      users: (cfg.users ?? []).join(", "),
      pin: cfg.pinToHomepage ?? DEFAULTS.pin,
      minItems: cfg.minItems ?? DEFAULTS.minItems,
      maxItems: cfg.maxItems ?? DEFAULTS.maxItems,
      minLib: cfg.minLibrarySize ?? DEFAULTS.minLib,
    });
    setDirty(false);
  }, [job.config]);

  const updateMutation = trpc.jobs.update.useMutation({
    onSuccess: () => utils.jobs.list.invalidate(),
  });

  const handleSave = () => {
    const config: Record<string, unknown> = {};
    if (sections.length > 0) config.sections = sections;
    config.limit = form.limit;
    config.mode = form.mode;
    const users = form.users
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    if (users.length > 0) config.users = users;
    config.pinToHomepage = form.pin;
    config.minItems = form.minItems;
    config.maxItems = form.maxItems;
    config.minLibrarySize = form.minLib;
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
          <BywConfigRows
            state={form}
            onChange={(next) => {
              setForm(next);
              setDirty(true);
            }}
          />
        </ConfigPanel>
        <RunHistoryPanel runsQuery={actions.runsQuery} />
      </div>
      <GeneratedCollectionsPanel />
      <LatestRunLogPanel latestRun={actions.latestRun} />
    </JobPageShell>
  );
}
