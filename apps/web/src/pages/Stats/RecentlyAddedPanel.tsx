import type React from "react";
import { Link } from "react-router-dom";
import RelativeTime from "#components/RelativeTime";
import { ListSkeleton } from "#components/Skeleton";
import ErrorState from "#components/ErrorState";
import { trpc } from "#/trpc";
import { EMPTY, formatFileSize } from "#/format";
import styles from "#pages/Stats/Stats.module.css";
import SortableTh from "#components/SortableTh";
import { useLocalSort } from "#hooks/useLocalSort";
import { type PanelDragProps, PanelShell } from "./PanelShell";

export function RecentlyAddedPanel({
  dragHandle,
  dragProps,
}: {
  dragHandle: React.ReactNode;
  dragProps: PanelDragProps;
}) {
  const recentQuery = trpc.stats.recentlyAdded.useQuery();

  const { sortKey, sortDir, toggleSort, sorted } = useLocalSort({
    rows: recentQuery.data?.items ?? [],
    accessors: {
      title: (i) => i.title,
      type: (i) => i.type,
      container: (i) => i.container,
      videoResolution: (i) => i.videoResolution,
      fileSize: (i) => i.fileSize,
      addedAt: (i) => i.addedAt,
    },
    defaultKey: "addedAt",
    defaultDir: "desc",
    descFirst: ["addedAt", "fileSize"],
  });

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
        <div className="table-scroll in-panel" data-scroll="x">
          <table className={styles.compactTable}>
            <thead>
              <tr>
                <SortableTh sortKey="title" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Title
                </SortableTh>
                <SortableTh sortKey="type" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Type
                </SortableTh>
                <SortableTh sortKey="container" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Format
                </SortableTh>
                <SortableTh sortKey="videoResolution" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Resolution
                </SortableTh>
                <SortableTh sortKey="fileSize" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Size
                </SortableTh>
                <SortableTh sortKey="addedAt" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Added
                </SortableTh>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 8).map((item) => {
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
