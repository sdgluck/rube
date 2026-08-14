import { Link } from "react-router-dom";
import { ListSkeleton } from "#components/Skeleton";
import ErrorState from "#components/ErrorState";
import { trpc } from "#/trpc";
import styles from "#pages/Stats/Stats.module.css";
import SortableTh from "#components/SortableTh";
import { useLocalSort } from "#hooks/useLocalSort";
import { PanelShell, type DashboardPanelProps } from "#components/dashboard";
import { PeriodSelector } from "./PeriodSelector";
import { usePeriod } from "./usePeriod";

export function MostWatchedPanel({ dragHandle, dragProps }: DashboardPanelProps) {
  const { periodDays, setPeriodDays, label } = usePeriod();
  const mostWatchedQuery = trpc.stats.mostWatched.useQuery({ periodDays });
  const maxPlays = mostWatchedQuery.data?.[0]?.plays ?? 1;

  const { sortKey, sortDir, toggleSort, sorted } = useLocalSort({
    rows: mostWatchedQuery.data ?? [],
    accessors: {
      title: (i) => (i.grandparentTitle ? `${i.grandparentTitle} — ${i.title}` : i.title),
      plays: (i) => i.plays,
    },
    defaultKey: "plays",
    defaultDir: "desc",
    descFirst: ["plays"],
  });

  return (
    <PanelShell
      title="Most Watched"
      actions={<PeriodSelector value={periodDays} onChange={setPeriodDays} />}
      dragHandle={dragHandle}
      dragProps={dragProps}
    >
      {mostWatchedQuery.isLoading && <ListSkeleton rows={3} />}
      {mostWatchedQuery.error && (
        <ErrorState inline title="Couldn't load watch history" onRetry={() => mostWatchedQuery.refetch()} />
      )}
      {mostWatchedQuery.data && mostWatchedQuery.data.length === 0 && (
        <div className={styles.muted}>
          {periodDays === 0
            ? "No watch history yet — it fills in as things are played, or run Import Plex Watch History from Jobs."
            : `No watch history in the last ${label}`}
        </div>
      )}
      {mostWatchedQuery.data && mostWatchedQuery.data.length > 0 && (
        <div className="table-scroll in-panel" data-scroll="x">
          <table className={styles.compactTable}>
            <thead>
              <tr>
                <th className={styles.rankCol}>#</th>
                <SortableTh sortKey="title" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Title
                </SortableTh>
                <SortableTh
                  sortKey="plays"
                  activeKey={sortKey}
                  activeDir={sortDir}
                  onSort={toggleSort}
                  className={styles.playsCol}
                >
                  Plays
                </SortableTh>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 8).map((item, i) => (
                <tr key={i}>
                  <td className={styles.rankCell}>{i + 1}</td>
                  <td className={styles.titleCell}>
                    {item.ratingKey ? (
                      <Link to={`/media/${item.ratingKey}`} className={styles.titleLink}>
                        <span className={styles.titleText}>
                          {item.grandparentTitle ? `${item.grandparentTitle} — ${item.title}` : item.title}
                          {item.year ? ` (${item.year})` : ""}
                        </span>
                      </Link>
                    ) : (
                      <span className={styles.titleText}>
                        {item.grandparentTitle ? `${item.grandparentTitle} — ${item.title}` : item.title}
                        {item.year ? ` (${item.year})` : ""}
                      </span>
                    )}
                  </td>
                  <td className={styles.playsCell}>
                    <div className={styles.playsBar}>
                      <div className={styles.playsBarFill} style={{ width: `${(item.plays / maxPlays) * 100}%` }} />
                      <span className={styles.playsCount}>{item.plays}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
}
