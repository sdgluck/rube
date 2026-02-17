import { trpc } from "../trpc";
import styles from "./Stats.module.css";

function decisionLabel(decision: string) {
  switch (decision) {
    case "transcode":
      return "Transcoding";
    case "copy":
      return "Direct Stream";
    default:
      return "Direct Play";
  }
}

function decisionClass(decision: string) {
  switch (decision) {
    case "transcode":
      return styles.badgeTranscode;
    case "copy":
      return styles.badgeDirectStream;
    default:
      return styles.badgeDirectPlay;
  }
}

function stateLabel(state: string) {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function stateClass(state: string) {
  switch (state) {
    case "paused":
      return styles.badgePaused;
    default:
      return styles.badgePlaying;
  }
}

export default function Stats() {
  const sessionsQuery = trpc.stats.sessions.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const recentQuery = trpc.stats.recentlyAdded.useQuery();
  const mostWatchedQuery = trpc.stats.mostWatched.useQuery();

  return (
    <div>
      <h2 className={styles.heading}>Stats</h2>

      {/* Active Streams */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Active Streams</div>
        {sessionsQuery.error && <div className={styles.error}>Failed to load sessions</div>}
        {sessionsQuery.data && sessionsQuery.data.length === 0 && (
          <div className={styles.emptyState}>No active streams</div>
        )}
        {sessionsQuery.data && sessionsQuery.data.length > 0 && (
          <div className={styles.sessionGrid}>
            {sessionsQuery.data.map((session, i) => (
              <div key={i} className={styles.sessionCard}>
                {session.thumb ? (
                  <img
                    className={styles.sessionThumb}
                    src={`/api/plex-image?path=${encodeURIComponent(session.thumb)}`}
                    alt={session.title}
                  />
                ) : (
                  <div className={styles.sessionThumbPlaceholder} />
                )}
                <div className={styles.sessionInfo}>
                  <div className={styles.sessionTitle}>
                    {session.grandparentTitle ? `${session.grandparentTitle} — ${session.title}` : session.title}
                  </div>
                  {session.year && <div className={styles.sessionSubtitle}>{session.year}</div>}
                  <div className={styles.sessionMeta}>
                    {session.user} &middot; {session.player}
                  </div>
                  <div className={styles.badges}>
                    <span className={`${styles.badge} ${stateClass(session.state)}`}>{stateLabel(session.state)}</span>
                    <span className={`${styles.badge} ${decisionClass(session.decision)}`}>
                      {decisionLabel(session.decision)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recently Added */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Recently Added</div>
        {recentQuery.error && <div className={styles.error}>Failed to load recently added</div>}
        {recentQuery.data && recentQuery.data.length === 0 && (
          <div className={styles.emptyState}>No recently added media</div>
        )}
        {recentQuery.data && recentQuery.data.length > 0 && (
          <div className={styles.scrollRow}>
            {recentQuery.data.map((item) => (
              <div key={item.ratingKey} className={styles.posterCard}>
                {item.thumb ? (
                  <img
                    className={styles.posterImg}
                    src={`/api/plex-image?path=${encodeURIComponent(item.thumb)}`}
                    alt={item.title}
                    loading="lazy"
                  />
                ) : (
                  <div className={styles.posterPlaceholder}>No poster</div>
                )}
                <div className={styles.posterTitle} title={item.title}>
                  {item.title}
                </div>
                {item.year && <div className={styles.posterMeta}>{item.year}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Most Watched This Week */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Most Watched This Week</div>
        {mostWatchedQuery.error && <div className={styles.error}>Failed to load most watched</div>}
        {mostWatchedQuery.data && mostWatchedQuery.data.length === 0 && (
          <div className={styles.emptyState}>No watch history this week</div>
        )}
        {mostWatchedQuery.data && mostWatchedQuery.data.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Plays</th>
              </tr>
            </thead>
            <tbody>
              {mostWatchedQuery.data.map((item, i) => (
                <tr key={i}>
                  <td className={styles.rank}>{i + 1}</td>
                  <td>
                    {item.grandparentTitle ? `${item.grandparentTitle} — ${item.title}` : item.title}
                    {item.year ? ` (${item.year})` : ""}
                  </td>
                  <td className={styles.plays}>{item.plays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
