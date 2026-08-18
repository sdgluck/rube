import { Link } from "react-router-dom";
import { ListSkeleton } from "#components/Skeleton";
import ErrorState from "#components/ErrorState";
import { trpc } from "#/trpc";
import styles from "#pages/Stats/Stats.module.css";
import { formatDuration } from "#/format";
import { PanelShell, type DashboardPanelProps } from "#components/dashboard";
import { PeriodSelector } from "./PeriodSelector";
import { usePeriod } from "./usePeriod";

/**
 * Who is actually using the server.
 *
 * Ranked by plays rather than watch time — see `topUsers` in the playback
 * domain: history imported from Plex carries no duration, so a time-ranked list
 * on a server that backfilled would rank by "who has been watching since we
 * started sampling" and present it as "who watches most". The time is shown
 * beside the count regardless, because forty plays of five minutes each and
 * forty films are not the same user.
 */
export function TopUsersPanel({ dragHandle, dragProps }: DashboardPanelProps) {
  const { periodDays, setPeriodDays, label } = usePeriod();
  const topUsersQuery = trpc.stats.topUsers.useQuery({ periodDays, limit: 8 });

  const rows = topUsersQuery.data ?? [];
  const maxPlays = rows.length > 0 ? Math.max(...rows.map((r) => r.plays)) : 1;

  return (
    <PanelShell
      title="Top Users"
      actions={<PeriodSelector value={periodDays} onChange={setPeriodDays} />}
      dragHandle={dragHandle}
      dragProps={dragProps}
    >
      {topUsersQuery.isLoading && <ListSkeleton rows={3} />}
      {topUsersQuery.error && (
        <ErrorState inline title="Couldn't load user activity" onRetry={() => topUsersQuery.refetch()} />
      )}
      {topUsersQuery.data && rows.length === 0 && (
        <div className={styles.muted}>
          {periodDays === 0
            ? "No watch history yet — it fills in as things are played, or run Import Plex Watch History from Jobs."
            : `Nobody watched anything in the last ${label}`}
        </div>
      )}
      {rows.length > 0 && (
        <div className="table-scroll in-panel" data-scroll="x">
          <table className={styles.compactTable}>
            <thead>
              <tr>
                <th className={styles.rankCol}>#</th>
                <th>User</th>
                <th className={styles.watchedCol}>Watched</th>
                <th className={styles.playsCol}>Plays</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.userId}>
                  <td className={styles.rankCell}>{i + 1}</td>
                  <td className={styles.titleCell}>
                    {/* The unknown-user sentinel is not an account, so it gets
                        no link — /users/0 is a page that cannot exist. */}
                    {row.userId > 0 ? (
                      <Link to={`/users/${row.userId}`} className={styles.titleLink}>
                        <span className={styles.userNameCell}>{row.name}</span>
                      </Link>
                    ) : (
                      <span className={`${styles.userNameCell} ${styles.unknownCell}`}>{row.name}</span>
                    )}
                  </td>
                  <td className={styles.watchedCell}>{row.watchedMs > 0 ? formatDuration(row.watchedMs) : "—"}</td>
                  <td className={styles.playsCell}>
                    <div className={styles.playsBar}>
                      <div className={styles.playsBarFill} style={{ width: `${(row.plays / maxPlays) * 100}%` }} />
                      <span className={styles.playsCount}>{row.plays}</span>
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
