import type React from "react";
import { Link } from "react-router-dom";
import { ListSkeleton } from "#components/Skeleton";
import { trpc } from "#/trpc";
import styles from "#pages/Stats/Stats.module.css";
import { formatBandwidth, formatClock, formatCodec, formatResolution } from "#/format";
import { type PanelDragProps, PanelShell } from "./PanelShell";

export function StreamsPanel({ dragHandle, dragProps }: { dragHandle: React.ReactNode; dragProps: PanelDragProps }) {
  const sessionsQuery = trpc.stats.sessions.useQuery(undefined, { refetchInterval: 5000 });
  const sessions = sessionsQuery.data ?? [];

  return (
    <PanelShell
      title="Active Streams"
      badge={sessions.length > 0 ? <span className={styles.countBadge}>{sessions.length}</span> : null}
      dragHandle={dragHandle}
      dragProps={dragProps}
    >
      {sessionsQuery.isLoading && <ListSkeleton rows={3} />}
      {sessionsQuery.error && <div className={styles.error}>Failed to load sessions</div>}
      {!sessionsQuery.isLoading && sessions.length === 0 && <div className={styles.muted}>No active streams</div>}

      {sessions.length > 0 && (
        <div className="table-scroll">
          <table className={styles.compactTable}>
            <thead>
              <tr>
                <th></th>
                <th>Title</th>
                <th>User</th>
                <th className={styles.hideOnMobile}>Quality</th>
                <th className={styles.hideOnMobile}>Bandwidth</th>
                <th>Progress</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session, i) => {
                const progress =
                  session.duration && session.viewOffset
                    ? Math.min(100, (session.viewOffset / session.duration) * 100)
                    : 0;
                const isEpisode = session.type === "episode";
                const isTrack = session.type === "track";
                const title =
                  isEpisode && session.grandparentTitle
                    ? session.grandparentTitle
                    : isTrack && session.grandparentTitle
                      ? `${session.grandparentTitle} — ${session.title}`
                      : session.title;
                const epInfo =
                  isEpisode && session.parentIndex != null && session.index != null
                    ? `S${String(session.parentIndex).padStart(2, "0")}E${String(session.index).padStart(2, "0")}`
                    : null;
                const qualityParts: string[] = [];
                if (session.videoResolution) qualityParts.push(formatResolution(session.videoResolution));
                if (session.videoCodec) qualityParts.push(formatCodec(session.videoCodec));
                return (
                  <tr key={i}>
                    <td>
                      <span className={styles.statusDot} data-state={session.state} title={session.state} />
                    </td>
                    <td className={styles.titleCell}>
                      {(() => {
                        const linkKey = isEpisode
                          ? (session.grandparentRatingKey ?? session.ratingKey)
                          : session.ratingKey;
                        const inner = (
                          <span className={styles.titleText}>
                            {title}
                            {epInfo && <span className={styles.epLabel}> · {epInfo}</span>}
                          </span>
                        );
                        return linkKey ? (
                          <Link to={`/media/${linkKey}`} className={styles.titleLink}>
                            {inner}
                          </Link>
                        ) : (
                          inner
                        );
                      })()}
                    </td>
                    <td className={styles.userCell}>{session.user}</td>
                    <td className={`${styles.monoCell} ${styles.hideOnMobile}`}>{qualityParts.join(" ")}</td>
                    <td className={`${styles.monoCell} ${styles.hideOnMobile}`}>
                      {session.bandwidth ? formatBandwidth(session.bandwidth) : ""}
                    </td>
                    <td className={styles.progressCell}>
                      {session.duration != null && session.duration > 0 && (
                        <div
                          className={styles.miniProgress}
                          title={`${formatClock(session.viewOffset ?? 0)} / ${formatClock(session.duration)}`}
                        >
                          <div
                            className={styles.miniProgressFill}
                            data-state={session.state}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      )}
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
