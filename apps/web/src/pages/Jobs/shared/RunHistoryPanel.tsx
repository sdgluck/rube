import { Link } from "react-router-dom";
import RelativeTime from "#components/RelativeTime";
import EmptyState from "#components/EmptyState";
import styles from "#pages/Jobs/Jobs.module.css";
import StatusBadge from "./StatusBadge";
import { formatElapsed } from "#/format";
import type { useJobActions } from "./useJobActions";

interface Props {
  runsQuery: ReturnType<typeof useJobActions>["runsQuery"];
}

export default function RunHistoryPanel({ runsQuery }: Props) {
  return (
    <fieldset className={styles.detailSectionCapped}>
      <legend className={styles.detailSectionTitle}>Run History</legend>
      {runsQuery.isLoading ? (
        <p>Loading runs…</p>
      ) : runsQuery.data && runsQuery.data.length > 0 ? (
        <div className="table-scroll">
          <table className={styles.compactTable}>
            <thead>
              <tr>
                <th>Status</th>
                <th>Started</th>
                <th>Duration</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runsQuery.data.map((run) => (
                <tr key={run.id}>
                  <td>
                    <StatusBadge status={run.status} />
                  </td>
                  <td className={styles.runMeta}>
                    <RelativeTime timestamp={run.startedAt} />
                  </td>
                  <td className={styles.runMeta}>{formatElapsed(run.startedAt, run.finishedAt)}</td>
                  <td>
                    <Link to={`/jobs/runs/${run.id}`} className={styles.runLink}>
                      View Log
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon="list" title="No runs yet" />
      )}
    </fieldset>
  );
}
