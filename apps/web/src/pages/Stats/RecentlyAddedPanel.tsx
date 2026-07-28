import type React from "react";
import { Link } from "react-router-dom";
import RelativeTime from "#components/RelativeTime";
import { ListSkeleton } from "#components/Skeleton";
import ErrorState from "#components/ErrorState";
import { trpc } from "#/trpc";
import { EMPTY, formatFileSize } from "#/format";
import styles from "#pages/Stats/Stats.module.css";
import { type PanelDragProps, PanelShell } from "./PanelShell";

export function RecentlyAddedPanel({
  dragHandle,
  dragProps,
}: {
  dragHandle: React.ReactNode;
  dragProps: PanelDragProps;
}) {
  const recentQuery = trpc.stats.recentlyAdded.useQuery();

  return (
    <PanelShell title="Recently Added" dragHandle={dragHandle} dragProps={dragProps}>
      {recentQuery.isLoading && <ListSkeleton rows={3} />}
      {recentQuery.error && (
        <ErrorState inline title="Couldn't load recently added" onRetry={() => recentQuery.refetch()} />
      )}
      {recentQuery.data && recentQuery.data.items.length === 0 && (
        <div className={styles.muted}>No recently added media</div>
      )}
      {recentQuery.data && recentQuery.data.items.length > 0 && (
        <div className="table-scroll">
          <table className={styles.compactTable}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Format</th>
                <th>Resolution</th>
                <th>Size</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {recentQuery.data.items.slice(0, 8).map((item) => {
                const displayTitle =
                  item.type === "season" && item.parentTitle
                    ? `${item.parentTitle} — ${item.title}`
                    : item.type === "season" && item.grandparentTitle
                      ? `${item.grandparentTitle} — ${item.title}`
                      : item.type === "episode" && item.grandparentTitle
                        ? `${item.grandparentTitle} — ${item.title}`
                        : item.title;
                return (
                  <tr key={item.ratingKey}>
                    <td className={styles.titleCell}>
                      <Link to={`/media/${item.ratingKey}`} className={styles.titleLink}>
                        <span className={styles.titleText}>{displayTitle}</span>
                      </Link>
                    </td>
                    <td className={styles.monoCell}>{item.type.charAt(0).toUpperCase() + item.type.slice(1)}</td>
                    <td className={styles.monoCell}>{item.container?.toUpperCase() || EMPTY}</td>
                    <td className={styles.monoCell}>{item.videoResolution?.toUpperCase() || EMPTY}</td>
                    <td className={styles.monoCell}>{formatFileSize(item.fileSize)}</td>
                    <td className={styles.monoCell}>
                      <RelativeTime timestamp={item.addedAt} seconds />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
}
