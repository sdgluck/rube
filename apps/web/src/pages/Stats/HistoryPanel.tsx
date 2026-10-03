import { useState } from "react";
import { Link } from "react-router-dom";
import { ListSkeleton } from "#components/Skeleton";
import ErrorState from "#components/ErrorState";
import { trpc } from "#/trpc";
import styles from "#pages/Stats/Stats.module.css";
import { formatRuntime } from "#/format";
import RelativeTime from "#components/RelativeTime";
import { PanelCountBadge, PanelShell, type DashboardPanelProps } from "#components/dashboard";
import SortableTh, { type SortDir } from "#components/SortableTh";
import { PeriodSelector } from "./PeriodSelector";
import { usePeriod } from "./usePeriod";
import PanelEmpty from "./PanelEmpty";

/** 25 rows is as much as the panel can show without dominating the dashboard. */
const PAGE_SIZES = [10, 15, 20, 25] as const;
const DEFAULT_PAGE_SIZE = 10;

type SortKey = "when" | "title" | "user" | "device" | "play" | "watched";

/** Columns where the useful first click is "most/latest first". */
const DESC_FIRST: SortKey[] = ["when", "watched"];

/** Human label for the stored session state. */
const STATE_LABELS: Record<string, string> = {
  playing: "Playing",
  paused: "Paused",
  completed: "Completed",
  abandoned: "Stopped",
  stale: "Unknown",
};

export function HistoryPanel({ dragHandle, dragProps }: DashboardPanelProps) {
  const { periodDays, setPeriodDays, label } = usePeriod();
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [sort, setSort] = useState<SortKey>("when");
  const [dir, setDir] = useState<SortDir>("desc");

  const historyQuery = trpc.stats.history.useQuery({ periodDays, limit: pageSize, offset, sort, dir });
  const rows = historyQuery.data?.rows ?? [];
  const total = historyQuery.data?.total ?? 0;

  // Anything that reorders or resizes the list restarts it: a deep offset held
  // across the change would land on an unrelated page, or an empty one.
  const changePeriod = (days: typeof periodDays) => {
    setPeriodDays(days);
    setOffset(0);
  };

  // Sorting happens server-side — the page in hand is a slice of the whole
  // history, so sorting it locally would only reorder those few rows.
  const toggleSort = (key: SortKey) => {
    if (key === sort) {
      setDir(dir === "asc" ? "desc" : "asc");
    } else {
      setSort(key);
      setDir(DESC_FIRST.includes(key) ? "desc" : "asc");
    }
    setOffset(0);
  };

  return (
    <PanelShell
      title="Playback History"
      badge={total > 0 ? <PanelCountBadge>{total}</PanelCountBadge> : null}
      actions={<PeriodSelector value={periodDays} onChange={changePeriod} />}
      dragHandle={dragHandle}
      dragProps={dragProps}
    >
      {historyQuery.isLoading && <ListSkeleton rows={4} />}
      {historyQuery.error && (
        <ErrorState inline title="Couldn't load playback history" onRetry={() => historyQuery.refetch()} />
      )}
      {historyQuery.data && rows.length === 0 && (
        <PanelEmpty importHistory={periodDays === 0}>
          {periodDays === 0 ? "Nothing recorded yet" : `Nothing played in the last ${label}`}
        </PanelEmpty>
      )}

      {rows.length > 0 && (
        <>
          <div className="table-scroll in-panel" data-scroll="x">
            <table className={styles.compactTable}>
              <thead>
                <tr>
                  {(
                    [
                      { key: "title", label: "Title" },
                      { key: "user", label: "User" },
                      { key: "device", label: "Device", mobileHidden: true },
                      { key: "play", label: "Play", mobileHidden: true },
                      { key: "watched", label: "Watched" },
                      { key: "when", label: "When" },
                    ] as const
                  ).map((col) => (
                    <SortableTh
                      key={col.key}
                      sortKey={col.key}
                      activeKey={sort}
                      activeDir={dir}
                      onSort={toggleSort}
                      className={"mobileHidden" in col ? styles.hideOnMobile : undefined}
                    >
                      {col.label}
                    </SortableTh>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  // Rows imported from Plex's view log carry no completion or
                  // watch-time data. Showing 0% would read as "they bailed
                  // instantly" rather than "we don't know".
                  const imported = row.source !== "poller";
                  return (
                    <tr key={row.id}>
                      <td className={styles.titleCell}>
                        <Link to={`/media/${row.ratingKey}`} className={styles.titleLink}>
                          <span className={styles.titleText}>
                            {row.grandparentTitle ? `${row.grandparentTitle} — ${row.title}` : row.title}
                          </span>
                        </Link>
                      </td>
                      <td className={styles.userCell}>{row.username || `User ${row.userId}`}</td>
                      <td className={`${styles.monoCell} ${styles.hideOnMobile}`}>{row.player || "—"}</td>
                      <td className={`${styles.monoCell} ${styles.hideOnMobile}`}>
                        {imported ? (
                          <span className={styles.unknownCell} title="Imported from Plex history — not recorded live">
                            —
                          </span>
                        ) : (
                          row.decision || "—"
                        )}
                      </td>
                      <td className={styles.monoCell}>
                        {imported ? (
                          <span
                            className={styles.unknownCell}
                            title="Imported from Plex history, which records only that it was watched"
                          >
                            {STATE_LABELS[row.state] ?? row.state}
                          </span>
                        ) : (
                          `${formatRuntime(row.watchedMs)} · ${Math.round(row.completionPct * 100)}%`
                        )}
                      </td>
                      <td className={styles.monoCell}>
                        <RelativeTime timestamp={row.startedAt} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={styles.historyPager}>
            <label className={styles.pageSize}>
              Rows
              <select
                className={styles.pageSizeSelect}
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setOffset(0);
                }}
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            {total > pageSize && (
              <>
                <span>
                  {offset + 1}–{Math.min(offset + pageSize, total)} of {total}
                </span>
                <button
                  type="button"
                  className={styles.segmentedBtn}
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - pageSize))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className={styles.segmentedBtn}
                  disabled={offset + pageSize >= total}
                  onClick={() => setOffset(offset + pageSize)}
                >
                  Next
                </button>
              </>
            )}
          </div>
        </>
      )}
    </PanelShell>
  );
}
