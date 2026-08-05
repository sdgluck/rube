import type React from "react";
import { Link } from "react-router-dom";
import { ListSkeleton } from "#components/Skeleton";
import ErrorState from "#components/ErrorState";
import { trpc } from "#/trpc";
import styles from "#pages/Stats/Stats.module.css";
import { type PanelDragProps, PanelShell } from "./PanelShell";

export function MostWatchedPanel({
  dragHandle,
  dragProps,
}: {
  dragHandle: React.ReactNode;
  dragProps: PanelDragProps;
}) {
  const mostWatchedQuery = trpc.stats.mostWatched.useQuery();
  const maxPlays = mostWatchedQuery.data?.[0]?.plays ?? 1;

  return (
    <PanelShell title="Most Watched This Week" dragHandle={dragHandle} dragProps={dragProps}>
      {mostWatchedQuery.isLoading && <ListSkeleton rows={3} />}
      {mostWatchedQuery.error && (
        <ErrorState inline title="Couldn't load watch history" onRetry={() => mostWatchedQuery.refetch()} />
      )}
      {mostWatchedQuery.data && mostWatchedQuery.data.length === 0 && (
        <div className={styles.muted}>No watch history this week</div>
      )}
      {mostWatchedQuery.data && mostWatchedQuery.data.length > 0 && (
        <div className="table-scroll in-panel">
          <table className={styles.compactTable}>
            <thead>
              <tr>
                <th className={styles.rankCol}>#</th>
                <th>Title</th>
                <th className={styles.playsCol}>Plays</th>
              </tr>
            </thead>
            <tbody>
              {mostWatchedQuery.data.slice(0, 8).map((item, i) => (
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
