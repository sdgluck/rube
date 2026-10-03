import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RULE_CONCURRENCY_DEFAULT, RULE_CONCURRENCY_MAX } from "@tinkerbell/contracts";
import { trpc } from "#/trpc";
import { useJobActions } from "./shared/useJobActions";
import JobPageShell from "./shared/JobPageShell";
import ConfigPanel from "./shared/ConfigPanel";
import RunHistoryPanel from "./shared/RunHistoryPanel";
import LatestRunLogPanel from "./shared/LatestRunLogPanel";
import RuleBreakdownPanel from "./shared/RuleBreakdownPanel";
import JobConfigRows from "./shared/JobConfigRows";
import styles from "#pages/Jobs/Jobs.module.css";
import type { JobPageProps } from "./types";

/**
 * Config page for both batch rule jobs.
 *
 * `generate` and `cleanup` run the same engine over different rules, so they
 * take the same settings — libraries and how many rules at a time. Only the
 * list they send you to differs.
 */
export default function GenerateJob({ job }: JobPageProps) {
  const isCleanup = job.command === "cleanup";
  const utils = trpc.useUtils();
  const actions = useJobActions(job);
  const [sections, setSections] = useState<string[]>([]);
  const [concurrency, setConcurrency] = useState<number>(RULE_CONCURRENCY_DEFAULT);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const cfg = (job.config ?? {}) as { sections?: string[]; ruleConcurrency?: number };
    setSections(cfg.sections ?? []);
    setConcurrency(cfg.ruleConcurrency ?? RULE_CONCURRENCY_DEFAULT);
    setDirty(false);
  }, [job.config]);

  const updateMutation = trpc.jobs.update.useMutation({
    onSuccess: () => utils.jobs.list.invalidate(),
  });

  const handleSave = () => {
    const configPatch: Record<string, unknown> = { sections };
    // Left unset at the default, so the job keeps following it if it changes.
    configPatch.ruleConcurrency = concurrency === RULE_CONCURRENCY_DEFAULT ? null : concurrency;
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
          <tr>
            <td className={styles.fieldLabel}>Rules at a time</td>
            <td>
              <input
                type="number"
                className={styles.configNumberInput}
                min={1}
                max={RULE_CONCURRENCY_MAX}
                value={concurrency}
                onChange={(e) => {
                  const next = parseInt(e.target.value, 10) || RULE_CONCURRENCY_DEFAULT;
                  setConcurrency(Math.max(1, Math.min(RULE_CONCURRENCY_MAX, next)));
                  setDirty(true);
                }}
              />
              <div className={styles.fieldHelp}>
                {concurrency === 1
                  ? "One rule at a time — slowest, gentlest on your Plex server"
                  : `Up to ${concurrency} rules run together. Faster, but more load on Plex and the metadata APIs.`}
              </div>
            </td>
          </tr>
          <tr>
            <td className={styles.fieldLabel}>Rules</td>
            <td>
              <Link to={isCleanup ? "/cleanup/rules" : "/rules"}>
                {isCleanup ? "Manage cleanup rules" : "Manage rules"} &rarr;
              </Link>
            </td>
          </tr>
        </ConfigPanel>
        <RunHistoryPanel runsQuery={actions.runsQuery} />
      </div>
      <RuleBreakdownPanel jobRunId={actions.latestRun?.id} />
      <LatestRunLogPanel latestRun={actions.latestRun} />
    </JobPageShell>
  );
}
