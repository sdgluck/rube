import { Link } from "react-router-dom";
import RelativeTime from "#components/RelativeTime";
import EmptyState from "#components/EmptyState";
import styles from "#pages/Jobs/Jobs.module.css";
import StatusBadge from "./StatusBadge";
import { formatElapsed } from "#/format";
import type { useJobActions } from "./useJobActions";
import CardSection from "#components/CardSection";
import SortableTh from "#components/SortableTh";
import { useLocalSort } from "#hooks/useLocalSort";

interface Props {
  runsQuery: ReturnType<typeof useJobActions>["runsQuery"];
}

export default function RunHistoryPanel({ runsQuery }: Props) {
  const { sortKey, sortDir, toggleSort, sorted } = useLocalSort({
    rows: runsQuery.data ?? [],
    accessors: {
      status: (r) => r.status,
      startedAt: (r) => r.startedAt,
      // A run still going has no finish time; sort those by elapsed so far
      // rather than dropping them to the bottom as "missing".
      duration: (r) => (r.finishedAt ?? Date.now()) - r.startedAt,
    },
    defaultKey: "startedAt",
    defaultDir: "desc",
    descFirst: ["startedAt", "duration"],
  });

  return (
    <CardSection className={styles.detailSectionCapped} titleClassName={styles.detailSectionTitle} title="Run History">
      {runsQuery.isLoading ? (
        <p>Loading runs…</p>
      ) : runsQuery.data && runsQuery.data.length > 0 ? (
        <div className="table-scroll in-panel">
          <table className={styles.compactTable}>
            <thead>
              <tr>
                <SortableTh sortKey="status" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Status
                </SortableTh>
                <SortableTh sortKey="startedAt" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Started
                </SortableTh>
                <SortableTh sortKey="duration" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Duration
                </SortableTh>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((run) => (
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
    </CardSection>
  );
}
