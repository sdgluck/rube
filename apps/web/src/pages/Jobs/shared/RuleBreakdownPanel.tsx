import { Link } from "react-router-dom";
import CardSection from "#components/CardSection";
import EmptyState from "#components/EmptyState";
import RelativeTime from "#components/RelativeTime";
import { trpc } from "#/trpc";
import { formatElapsed } from "#/format";
import styles from "#pages/Jobs/Jobs.module.css";
import { isRunActive } from "./useRunLog";

interface Props {
  /** The job run to break down. Null while the job has never run. */
  jobRunId: string | null | undefined;
}

/**
 * What a batch run did, rule by rule.
 *
 * A Generate run's log is one transcript of thirty-odd rules, which answers
 * "did the job work?" but not "did *my* rule work?" — the question people
 * actually arrive with. Each rule in a batch now writes its own run row, so the
 * answer is a table: which rules ran, how long each took, what each produced,
 * and which one is running right now.
 */
export default function RuleBreakdownPanel({ jobRunId }: Props) {
  const runsQuery = trpc.rules.runsForJobRun.useQuery(
    { jobRunId: jobRunId! },
    // Poll while the job is live so rules appear as they finish; a run that is
    // over never changes.
    {
      enabled: !!jobRunId,
      refetchInterval: (query) => (query.state.data?.some((r) => isRunActive(r.status)) ? 3000 : false),
    },
  );

  if (!jobRunId) return null;
  const runs = runsQuery.data ?? [];

  return (
    <CardSection
      className={styles.detailSectionCapped}
      titleClassName={styles.detailSectionTitle}
      title={`Rules in this run${runs.length > 0 ? ` (${runs.length})` : ""}`}
    >
      {runsQuery.isLoading ? (
        <p>Loading rules…</p>
      ) : runs.length === 0 ? (
        <EmptyState icon="list" title="No rules yet" description="Rules appear here as the run reaches them." />
      ) : (
        <div className="table-scroll in-panel" data-scroll="x">
          <table className={styles.compactTable}>
            <thead>
              <tr>
                <th>Rule</th>
                <th>Status</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Collections</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <Link to={`/rules/${run.ruleId}/runs?run=${run.id}`}>{run.ruleName}</Link>
                  </td>
                  <td>
                    <span
                      className={`${styles.badge} ${
                        isRunActive(run.status)
                          ? styles.badgeRunning
                          : run.status === "ok"
                            ? styles.badgeCompleted
                            : run.status === "error"
                              ? styles.badgeFailed
                              : styles.badgeCancelled
                      }`}
                      title={run.error ?? undefined}
                    >
                      {run.status}
                    </span>
                  </td>
                  <td className={styles.runMeta}>
                    <RelativeTime timestamp={run.startedAt} />
                  </td>
                  <td className={styles.runMeta}>{formatElapsed(run.startedAt, run.finishedAt)}</td>
                  <td className={styles.runMeta}>{run.collectionCount ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CardSection>
  );
}
