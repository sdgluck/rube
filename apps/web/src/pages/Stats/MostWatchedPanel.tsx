import { useState } from "react";
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
import PanelEmpty from "./PanelEmpty";

/**
 * What "most watched" counts.
 *
 * "Plays" is every play; "Viewers" counts each person once, so one household
 * member rewatching a comfort show four times stops outranking the film
 * everybody actually watched. Not a sort of the same ten rows — it changes
 * which ten rows the server returns, which is why it lives in the query.
 */
const RANKS = [
  { id: "plays" as const, label: "Plays" },
  { id: "viewers" as const, label: "Viewers" },
];
type Rank = (typeof RANKS)[number]["id"];

export function MostWatchedPanel({ dragHandle, dragProps }: DashboardPanelProps) {
  const { periodDays, setPeriodDays, label } = usePeriod();
  const [rank, setRank] = useState<Rank>("plays");
  const mostWatchedQuery = trpc.stats.mostWatched.useQuery({ periodDays, rank });

  const countOf = (item: { plays: number; viewers: number }) => (rank === "viewers" ? item.viewers : item.plays);
  const rows = mostWatchedQuery.data ?? [];
  const maxCount = rows.length > 0 ? Math.max(...rows.map(countOf)) : 1;
  const countLabel = rank === "viewers" ? "Viewers" : "Plays";

  const { sortKey, sortDir, toggleSort, sorted } = useLocalSort({
    rows,
    accessors: {
      title: (i) => (i.grandparentTitle ? `${i.grandparentTitle} — ${i.title}` : i.title),
      count: countOf,
    },
    defaultKey: "count",
    defaultDir: "desc",
    descFirst: ["count"],
  });

  return (
    <PanelShell
      title="Most Watched"
      actions={
        <>
          <div className={styles.segmented} role="tablist" aria-label="Count by">
            {RANKS.map((r) => (
              <button
                key={r.id}
                type="button"
                role="tab"
                aria-selected={rank === r.id}
                className={`${styles.segmentedBtn} ${rank === r.id ? styles.segmentedBtnActive : ""}`}
                onClick={() => setRank(r.id)}
                title={
                  r.id === "viewers"
                    ? "Count each person once, however many times they played it"
                    : "Count every play, including repeats by the same person"
                }
              >
                {r.label}
              </button>
            ))}
          </div>
          <PeriodSelector value={periodDays} onChange={setPeriodDays} />
        </>
      }
      dragHandle={dragHandle}
      dragProps={dragProps}
    >
      {mostWatchedQuery.isLoading && <ListSkeleton rows={3} />}
      {mostWatchedQuery.error && (
        <ErrorState inline title="Couldn't load watch history" onRetry={() => mostWatchedQuery.refetch()} />
      )}
      {mostWatchedQuery.data && mostWatchedQuery.data.length === 0 && (
        <PanelEmpty importHistory={periodDays === 0}>
          {periodDays === 0 ? "No watch history yet" : `No watch history in the last ${label}`}
        </PanelEmpty>
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
                  sortKey="count"
                  activeKey={sortKey}
                  activeDir={sortDir}
                  onSort={toggleSort}
                  className={styles.playsCol}
                >
                  {countLabel}
                </SortableTh>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item, i) => (
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
                      <div className={styles.playsBarFill} style={{ width: `${(countOf(item) / maxCount) * 100}%` }} />
                      <span className={styles.playsCount}>{countOf(item)}</span>
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
