import { Link } from "react-router-dom";
import { useJobActions } from "./shared/useJobActions";
import JobPageShell from "./shared/JobPageShell";
import JobSettingsPanel from "./shared/JobSettingsPanel";
import RunHistoryPanel from "./shared/RunHistoryPanel";
import LatestRunLogPanel from "./shared/LatestRunLogPanel";
import RuleBreakdownPanel from "./shared/RuleBreakdownPanel";
import styles from "#pages/Jobs/Jobs.module.css";
import type { JobPageProps } from "./types";

/** Where each rule-engine job's rules are managed. */
const RULES_LINKS: Record<string, { to: string; label: string }> = {
  generate: { to: "/rules", label: "Manage rules" },
  cleanup: { to: "/cleanup/rules", label: "Manage cleanup rules" },
  metadata: { to: "/metadata", label: "Manage metadata rules" },
};

/**
 * The three batch rule jobs. They run one engine over different rules, so they
 * share settings (libraries, rules at a time) and a per-rule breakdown of the
 * last run — only the list they send you to differs.
 */
export default function GenerateJob({ job }: JobPageProps) {
  const actions = useJobActions(job);
  const rulesLink = RULES_LINKS[job.command] ?? RULES_LINKS.generate;
  return (
    <JobPageShell job={job} actions={actions}>
      <div className={styles.jobDetailColumns}>
        <JobSettingsPanel job={job}>
          <tr>
            <td className={styles.fieldLabel}>Rules</td>
            <td>
              <Link to={rulesLink.to}>{rulesLink.label} &rarr;</Link>
            </td>
          </tr>
        </JobSettingsPanel>
        <RunHistoryPanel runsQuery={actions.runsQuery} />
      </div>
      <RuleBreakdownPanel jobRunId={actions.latestRun?.id} />
      <LatestRunLogPanel latestRun={actions.latestRun} />
    </JobPageShell>
  );
}
