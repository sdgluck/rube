import { trpc } from "../trpc";
import styles from "./Stats.module.css";

function decisionLabel(decision: string) {
  switch (decision) {
    case "transcode":
      return "Transcode";
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
    case "buffering":
      return styles.badgeBuffering;
    default:
      return styles.badgePlaying;
  }
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBandwidth(kbps: number): string {
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}

function formatResolution(res: string | undefined): string {
  if (!res) return "";
  if (res === "4k") return "4K";
  return res + "p";
}

function formatCodec(codec: string | undefined): string {
  if (!codec) return "";
  const map: Record<string, string> = {
    h264: "H.264",
    hevc: "HEVC",
    h265: "HEVC",
    vp9: "VP9",
    av1: "AV1",
    mpeg4: "MPEG-4",
    vc1: "VC-1",
    aac: "AAC",
    ac3: "AC3",
    eac3: "EAC3",
    dca: "DTS",
    "dca-ma": "DTS-HD MA",
    truehd: "TrueHD",
    flac: "FLAC",
    mp3: "MP3",
    opus: "Opus",
    vorbis: "Vorbis",
    pcm: "PCM",
  };
  return map[codec.toLowerCase()] || codec.toUpperCase();
}

function formatChannels(ch: number | undefined): string {
  if (!ch) return "";
  if (ch === 8) return "7.1";
  if (ch === 6) return "5.1";
  if (ch === 2) return "Stereo";
  if (ch === 1) return "Mono";
  return `${ch}ch`;
}

function episodeLabel(session: { parentIndex?: number; index?: number }): string {
  if (session.parentIndex != null && session.index != null) {
    return `S${String(session.parentIndex).padStart(2, "0")}E${String(session.index).padStart(2, "0")}`;
  }
  return "";
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
        <div className={styles.sectionTitle}>
          Active Streams
          {sessionsQuery.data && sessionsQuery.data.length > 0 && (
            <span className={styles.streamCount}>{sessionsQuery.data.length}</span>
          )}
        </div>
        {sessionsQuery.error && <div className={styles.error}>Failed to load sessions</div>}
        {sessionsQuery.data && sessionsQuery.data.length === 0 && (
          <div className={styles.emptyState}>No active streams</div>
        )}
        {sessionsQuery.data && sessionsQuery.data.length > 0 && (
          <div className={styles.sessionGrid}>
            {sessionsQuery.data.map((session, i) => {
              const progress =
                session.duration && session.viewOffset
                  ? Math.min(100, (session.viewOffset / session.duration) * 100)
                  : 0;

              const epLabel = episodeLabel(session);
              const isEpisode = session.type === "episode";
              const isTrack = session.type === "track";

              const qualityParts: string[] = [];
              if (session.videoResolution) qualityParts.push(formatResolution(session.videoResolution));
              if (session.videoCodec) qualityParts.push(formatCodec(session.videoCodec));

              const audioParts: string[] = [];
              if (session.audioCodec) audioParts.push(formatCodec(session.audioCodec));
              if (session.audioChannels) audioParts.push(formatChannels(session.audioChannels));

              // Build transcode detail string
              let transcodeDetail = "";
              if (session.decision === "transcode") {
                const parts: string[] = [];
                if (session.videoDecision === "transcode" && session.sourceVideoCodec && session.videoCodec) {
                  parts.push(`${formatCodec(session.sourceVideoCodec)} → ${formatCodec(session.videoCodec)}`);
                }
                if (session.audioDecision === "transcode" && session.sourceAudioCodec && session.audioCodec) {
                  parts.push(`${formatCodec(session.sourceAudioCodec)} → ${formatCodec(session.audioCodec)}`);
                }
                if (session.transcodeHwEncoding) parts.push("HW");
                if (session.transcodeSpeed) parts.push(`${session.transcodeSpeed.toFixed(1)}x`);
                transcodeDetail = parts.join(" · ");
              }

              return (
                <div key={i} className={styles.sessionCard}>
                  <div className={styles.sessionThumbCol}>
                    {(isEpisode ? session.parentThumb || session.thumb : session.thumb) ? (
                      <img
                        className={styles.sessionThumb}
                        src={`/api/plex-image?path=${encodeURIComponent(isEpisode ? session.parentThumb || session.thumb! : session.thumb!)}`}
                        alt={session.title}
                      />
                    ) : (
                      <div className={styles.sessionThumbPlaceholder} />
                    )}
                  </div>
                  <div className={styles.sessionBody}>
                    <div className={styles.sessionHeader}>
                      <div className={styles.sessionTitleBlock}>
                        <div className={styles.sessionTitle}>
                          {isEpisode && session.grandparentTitle
                            ? session.grandparentTitle
                            : isTrack && session.grandparentTitle
                              ? `${session.grandparentTitle} — ${session.title}`
                              : session.title}
                        </div>
                        {isEpisode && (
                          <div className={styles.sessionEpisode}>
                            {epLabel && <span className={styles.epBadge}>{epLabel}</span>}
                            {session.title}
                          </div>
                        )}
                        {!isEpisode && !isTrack && session.year && (
                          <div className={styles.sessionSubtitle}>{session.year}</div>
                        )}
                      </div>
                      <div className={styles.sessionUserCol}>
                        {session.userThumb && (
                          <img className={styles.userAvatar} src={session.userThumb} alt={session.user} />
                        )}
                        <span className={styles.userName}>{session.user}</span>
                      </div>
                    </div>

                    {/* Progress bar */}
                    {session.duration != null && session.duration > 0 && (
                      <div className={styles.progressRow}>
                        <span className={styles.progressTime}>{formatDuration(session.viewOffset ?? 0)}</span>
                        <div className={styles.progressBarOuter}>
                          <div
                            className={`${styles.progressBarFill} ${session.state === "paused" ? styles.progressBarPaused : ""}`}
                            style={{ width: `${progress}%` }}
                          />
                          {session.transcodeProgress != null && session.transcodeProgress > progress && (
                            <div
                              className={styles.progressBarTranscode}
                              style={{ width: `${session.transcodeProgress}%` }}
                            />
                          )}
                        </div>
                        <span className={styles.progressTime}>{formatDuration(session.duration)}</span>
                      </div>
                    )}

                    {/* Stream details */}
                    <div className={styles.streamDetails}>
                      <div className={styles.badges}>
                        <span className={`${styles.badge} ${stateClass(session.state)}`}>
                          {stateLabel(session.state)}
                        </span>
                        <span className={`${styles.badge} ${decisionClass(session.decision)}`}>
                          {decisionLabel(session.decision)}
                        </span>
                        {session.location && (
                          <span
                            className={`${styles.badge} ${session.location === "lan" ? styles.badgeLocal : styles.badgeRemote}`}
                          >
                            {session.location === "lan" ? "Local" : "Remote"}
                          </span>
                        )}
                      </div>
                      <div className={styles.streamMeta}>
                        {qualityParts.length > 0 && (
                          <span className={styles.streamMetaItem}>{qualityParts.join(" ")}</span>
                        )}
                        {audioParts.length > 0 && <span className={styles.streamMetaItem}>{audioParts.join(" ")}</span>}
                        {session.bandwidth != null && session.bandwidth > 0 && (
                          <span className={styles.streamMetaItem}>{formatBandwidth(session.bandwidth)}</span>
                        )}
                      </div>
                    </div>

                    {transcodeDetail && <div className={styles.transcodeDetail}>{transcodeDetail}</div>}

                    {/* Player info */}
                    <div className={styles.playerInfo}>
                      {session.product || session.player}
                      {session.platform && ` (${session.platform})`}
                    </div>
                  </div>
                </div>
              );
            })}
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
