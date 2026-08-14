import { useState } from "react";
import { Link } from "react-router-dom";
import { ListSkeleton } from "#components/Skeleton";
import ErrorState from "#components/ErrorState";
import { trpc } from "#/trpc";
import styles from "#pages/Stats/Stats.module.css";
import { formatRuntime } from "#/format";
import RelativeTime from "#components/RelativeTime";
import { PanelCountBadge, PanelShell, type DashboardPanelProps } from "#components/dashboard";
import { PeriodSelector } from "./PeriodSelector";
import { usePeriod } from "./usePeriod";

const PAGE_SIZE = 25;

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

  const historyQuery = trpc.stats.history.useQuery({ periodDays, limit: PAGE_SIZE, offset });
  const rows = historyQuery.data?.rows ?? [];
  const total = historyQuery.data?.total ?? 0;

  // Changing the period with a deep offset would land on an empty page.
  const changePeriod = (days: typeof periodDays) => {
    setPeriodDays(days);
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
        <div className={styles.muted}>
          {periodDays === 0
            ? "Nothing recorded yet. History builds up as things are played — or run Import Plex Watch History from Jobs to seed it."
            : `Nothing played in the last ${label}`}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="table-scroll in-panel" data-scroll="x">
            <table className={styles.compactTable}>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>User</th>
                  <th className={styles.hideOnMobile}>Device</th>
                  <th className={styles.hideOnMobile}>Play</th>
                  <th>Watched</th>
                  <th>When</th>
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

          {total > PAGE_SIZE && (
            <div className={styles.historyPager}>
              <span>
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
              </span>
              <button
                type="button"
                className={styles.segmentedBtn}
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Newer
              </button>
              <button
                type="button"
                className={styles.segmentedBtn}
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Older
              </button>
            </div>
          )}
        </>
      )}
    </PanelShell>
  );
}
