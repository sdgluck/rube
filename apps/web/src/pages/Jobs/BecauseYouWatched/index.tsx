import { useEffect, useState } from "react";
import { trpc } from "#/trpc";
import { useJobActions } from "#pages/Jobs/shared/useJobActions";
import JobPageShell from "#pages/Jobs/shared/JobPageShell";
import ConfigPanel from "#pages/Jobs/shared/ConfigPanel";
import RunHistoryPanel from "#pages/Jobs/shared/RunHistoryPanel";
import LatestRunLogPanel from "#pages/Jobs/shared/LatestRunLogPanel";
import JobConfigRows from "#pages/Jobs/shared/JobConfigRows";
import styles from "#pages/Jobs/Jobs.module.css";
import type { JobPageProps } from "#pages/Jobs/types";
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
    const users = form.users
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    // Empty `sections`/`users` clear the key server-side, meaning "all".
    const configPatch = {
      sections,
      users,
      limit: form.limit,
      mode: form.mode,
      pinToHomepage: form.pin,
      minItems: form.minItems,
      maxItems: form.maxItems,
      minLibrarySize: form.minLib,
    };
    updateMutation.mutate({ jobId: job.id, configPatch }, { onSuccess: () => setDirty(false) });
  };

  return (
    <JobPageShell job={job} actions={actions}>
      <div className={styles.jobDetailColumns}>
        <ConfigPanel save={{ dirty, onSave: handleSave }}>
          <JobConfigRows
            job={job}
            sections={{
              value: sections,
              onChange: (next) => {
                setSections(next);
                setDirty(true);
              },
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
