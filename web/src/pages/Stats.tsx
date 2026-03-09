import { useState } from "react";
import { trpc } from "../trpc";
import EmptyState from "../EmptyState";
import PullToRefresh from "../PullToRefresh";
import styles from "./Stats.module.css";

type ViewMode = "table" | "grid";

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

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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

const DECISION_COLORS: Record<string, string> = {
  directplay: "#28a745",
  copy: "#7c4dff",
  transcode: "#ef4444",
};

function TranscodeDonut({ sessions }: { sessions: { decision: string }[] }) {
  if (sessions.length === 0) return null;

  const counts: Record<string, number> = {};
  for (const s of sessions) {
    const key = s.decision || "directplay";
    counts[key] = (counts[key] || 0) + 1;
  }

  const total = sessions.length;
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const segments = Object.entries(counts).map(([decision, count]) => {
    const pct = count / total;
    const dashLength = pct * circumference;
    const segment = (
      <circle
        key={decision}
        cx="24"
        cy="24"
        r={radius}
        fill="none"
        stroke={DECISION_COLORS[decision] || "#888"}
        strokeWidth="6"
        strokeDasharray={`${dashLength} ${circumference - dashLength}`}
        strokeDashoffset={-offset}
        style={{ transition: "stroke-dasharray 0.3s ease, stroke-dashoffset 0.3s ease" }}
      />
    );
    offset += dashLength;
    return segment;
  });

  return (
    <div className={styles.donutWrapper}>
      <svg width="48" height="48" viewBox="0 0 48 48">
        {segments}
      </svg>
      <div className={styles.donutLegend}>
        {Object.entries(counts).map(([decision, count]) => (
          <span key={decision} className={styles.donutLegendItem}>
            <span className={styles.donutLegendDot} style={{ background: DECISION_COLORS[decision] || "#888" }} />
            {decisionLabel(decision)} ({count})
          </span>
        ))}
      </div>
    </div>
  );
}

function BandwidthBars({ sessions }: { sessions: { bandwidth?: number; user: string }[] }) {
  const withBw = sessions.filter((s) => s.bandwidth && s.bandwidth > 0);
  if (withBw.length === 0) return null;

  const maxBw = Math.max(...withBw.map((s) => s.bandwidth!));

  return (
    <div className={styles.barsWrapper}>
      {withBw.map((s, i) => (
        <div key={i} className={styles.barRow}>
          <span className={styles.barLabel}>{s.user}</span>
          <div className={styles.barTrack}>
            <div
              className={styles.barFill}
              style={{
                width: `${(s.bandwidth! / maxBw) * 100}%`,
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <span className={styles.barValue}>{formatBandwidth(s.bandwidth!)}</span>
        </div>
      ))}
    </div>
  );
}

function episodeLabel(session: { parentIndex?: number; index?: number }): string {
  if (session.parentIndex != null && session.index != null) {
    return `S${String(session.parentIndex).padStart(2, "0")}E${String(session.index).padStart(2, "0")}`;
  }
  return "";
}

function SessionSkeleton() {
  return (
    <div className={styles.skeletonSessionCard}>
      <div className={styles.skeletonThumb} />
      <div className={styles.sessionBody}>
        <div className={styles.skeletonLine} style={{ width: "60%" }} />
        <div className={styles.skeletonLine} style={{ width: "40%", marginTop: 6 }} />
        <div className={styles.skeletonProgressBar} />
        <div style={{ display: "flex", gap: 5 }}>
          <div className={styles.skeletonBadge} />
          <div className={styles.skeletonBadge} />
        </div>
      </div>
    </div>
  );
}

function RecentlyAddedSkeleton() {
  return (
    <div className={styles.scrollRow}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} style={{ flexShrink: 0 }}>
          <div className={styles.skeletonPoster} />
          <div className={styles.skeletonPosterTitle} />
        </div>
      ))}
    </div>
  );
}

function MostWatchedSkeleton() {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>#</th>
          <th>Title</th>
          <th>Plays</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: 5 }, (_, i) => (
          <tr key={i} className={styles.skeletonTableRow}>
            <td>
              <div className={styles.skeletonTableCell} style={{ width: 20 }} />
            </td>
            <td>
              <div className={styles.skeletonTableCell} style={{ width: `${50 + (i % 3) * 15}%` }} />
            </td>
            <td>
              <div className={styles.skeletonTableCell} style={{ width: 30 }} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Stats() {
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem("streams-view") as ViewMode) || "grid",
  );
  const [recentViewMode, setRecentViewMode] = useState<ViewMode>(
    () => (localStorage.getItem("recent-view") as ViewMode) || "grid",
  );
  const sessionsQuery = trpc.stats.sessions.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const recentQuery = trpc.stats.recentlyAdded.useQuery();
  const mostWatchedQuery = trpc.stats.mostWatched.useQuery();

  const handleRefresh = () => {
    sessionsQuery.refetch();
    recentQuery.refetch();
    mostWatchedQuery.refetch();
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div>
        <h2 className={styles.heading}>Stats</h2>

        {/* Active Streams */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            Active Streams
            {sessionsQuery.data && sessionsQuery.data.length > 0 && (
              <span className={styles.streamCount}>{sessionsQuery.data.length}</span>
            )}
            <div className={styles.sectionTitleSpacer} />
            <div className={styles.viewToggle}>
              <button
                className={`${styles.viewToggleBtn} ${viewMode === "table" ? styles.viewToggleBtnActive : ""}`}
                onClick={() => {
                  setViewMode("table");
                  localStorage.setItem("streams-view", "table");
                }}
              >
                Table
              </button>
              <button
                className={`${styles.viewToggleBtn} ${viewMode === "grid" ? styles.viewToggleBtnActive : ""}`}
                onClick={() => {
                  setViewMode("grid");
                  localStorage.setItem("streams-view", "grid");
                }}
              >
                Grid
              </button>
            </div>
          </div>
          {sessionsQuery.data && sessionsQuery.data.length > 0 && (
            <div className={styles.vizRow}>
              <TranscodeDonut sessions={sessionsQuery.data} />
              <BandwidthBars sessions={sessionsQuery.data} />
            </div>
          )}
          {sessionsQuery.isLoading && (
            <div className={styles.sessionGrid}>
              <SessionSkeleton />
              <SessionSkeleton />
            </div>
          )}
          {sessionsQuery.error && (
            <div className={styles.error}>
              Failed to load sessions
              <button className={styles.retryBtn} onClick={() => sessionsQuery.refetch()}>
                Retry
              </button>
            </div>
          )}
          {sessionsQuery.data && sessionsQuery.data.length === 0 && (
            <EmptyState icon="monitor" title="No active streams" />
          )}
          {sessionsQuery.data && sessionsQuery.data.length > 0 && viewMode === "grid" && (
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
                          {audioParts.length > 0 && (
                            <span className={styles.streamMetaItem}>{audioParts.join(" ")}</span>
                          )}
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
          {sessionsQuery.data && sessionsQuery.data.length > 0 && viewMode === "table" && (
            <div className="table-scroll">
              <table className={styles.sessionsTable}>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>User</th>
                    <th>State</th>
                    <th>Decision</th>
                    <th>Quality</th>
                    <th>Bandwidth</th>
                    <th>Progress</th>
                    <th>Player</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionsQuery.data.map((session, i) => {
                    const progress =
                      session.duration && session.viewOffset
                        ? Math.min(100, (session.viewOffset / session.duration) * 100)
                        : 0;

                    const epLabel = episodeLabel(session);
                    const isEpisode = session.type === "episode";
                    const isTrack = session.type === "track";

                    const title =
                      isEpisode && session.grandparentTitle
                        ? session.grandparentTitle
                        : isTrack && session.grandparentTitle
                          ? `${session.grandparentTitle} — ${session.title}`
                          : session.title;

                    const qualityParts: string[] = [];
                    if (session.videoResolution) qualityParts.push(formatResolution(session.videoResolution));
                    if (session.videoCodec) qualityParts.push(formatCodec(session.videoCodec));
                    if (session.audioCodec) qualityParts.push(formatCodec(session.audioCodec));
                    if (session.audioChannels) qualityParts.push(formatChannels(session.audioChannels));

                    let transcodeDetail = "";
                    if (session.decision === "transcode") {
                      const parts: string[] = [];
                      if (session.videoDecision === "transcode" && session.sourceVideoCodec && session.videoCodec) {
                        parts.push(`${formatCodec(session.sourceVideoCodec)} → ${formatCodec(session.videoCodec)}`);
                      }
                      if (session.transcodeHwEncoding) parts.push("HW");
                      if (session.transcodeSpeed) parts.push(`${session.transcodeSpeed.toFixed(1)}x`);
                      transcodeDetail = parts.join(" · ");
                    }

                    return (
                      <tr key={i}>
                        <td>
                          <div className={styles.sessionTitle}>{title}</div>
                          {isEpisode && (
                            <div className={styles.sessionEpisode}>
                              {epLabel && <span className={styles.epBadge}>{epLabel}</span>}
                              {session.title}
                            </div>
                          )}
                          {!isEpisode && !isTrack && session.year && (
                            <div className={styles.sessionSubtitle}>{session.year}</div>
                          )}
                        </td>
                        <td>
                          <div className={styles.sessionUserCol}>
                            {session.userThumb && (
                              <img className={styles.userAvatar} src={session.userThumb} alt={session.user} />
                            )}
                            <span className={styles.userName}>{session.user}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`${styles.badge} ${stateClass(session.state)}`}>
                            {stateLabel(session.state)}
                          </span>
                        </td>
                        <td>
                          <span className={`${styles.badge} ${decisionClass(session.decision)}`}>
                            {decisionLabel(session.decision)}
                          </span>
                          {transcodeDetail && <div className={styles.transcodeDetailInline}>{transcodeDetail}</div>}
                        </td>
                        <td className={styles.qualityCell}>{qualityParts.join(" · ")}</td>
                        <td>
                          {session.bandwidth != null && session.bandwidth > 0 ? formatBandwidth(session.bandwidth) : ""}
                        </td>
                        <td>
                          {session.duration != null && session.duration > 0 && (
                            <div className={styles.tableProgressCell}>
                              <div className={styles.progressBarOuter}>
                                <div
                                  className={`${styles.progressBarFill} ${session.state === "paused" ? styles.progressBarPaused : ""}`}
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                              <span className={styles.progressTime}>
                                {formatDuration(session.viewOffset ?? 0)} / {formatDuration(session.duration)}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className={styles.playerCell}>
                          {session.product || session.player}
                          {session.platform && ` (${session.platform})`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recently Added */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            Recently Added
            <div className={styles.sectionTitleSpacer} />
            <div className={styles.viewToggle}>
              <button
                className={`${styles.viewToggleBtn} ${recentViewMode === "table" ? styles.viewToggleBtnActive : ""}`}
                onClick={() => {
                  setRecentViewMode("table");
                  localStorage.setItem("recent-view", "table");
                }}
              >
                Table
              </button>
              <button
                className={`${styles.viewToggleBtn} ${recentViewMode === "grid" ? styles.viewToggleBtnActive : ""}`}
                onClick={() => {
                  setRecentViewMode("grid");
                  localStorage.setItem("recent-view", "grid");
                }}
              >
                Grid
              </button>
            </div>
          </div>
          {recentQuery.isLoading && <RecentlyAddedSkeleton />}
          {recentQuery.data && !recentQuery.data.jobEnabled && (
            <div className={styles.emptyState}>The "Sync Recently Added" job is disabled. Results may be stale.</div>
          )}
          {recentQuery.error && (
            <div className={styles.error}>
              Failed to load recently added
              <button className={styles.retryBtn} onClick={() => recentQuery.refetch()}>
                Retry
              </button>
            </div>
          )}
          {recentQuery.data && recentQuery.data.items.length === 0 && (
            <EmptyState icon="film" title="No recently added media" />
          )}
          {recentQuery.data && recentQuery.data.items.length > 0 && recentViewMode === "grid" && (
            <div className={styles.scrollRow}>
              {recentQuery.data.items.map((item) => (
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
          {recentQuery.data && recentQuery.data.items.length > 0 && recentViewMode === "table" && (
            <div className="table-scroll">
              <table className={styles.sessionsTable}>
                <thead>
                  <tr>
                    <th></th>
                    <th>Title</th>
                    <th>Year</th>
                    <th>Type</th>
                    <th>Added</th>
                  </tr>
                </thead>
                <tbody>
                  {recentQuery.data.items.map((item) => (
                    <tr key={item.ratingKey}>
                      <td className={styles.recentThumbCell}>
                        {item.thumb ? (
                          <img
                            className={styles.recentThumb}
                            src={`/api/plex-image?path=${encodeURIComponent(item.thumb)}`}
                            alt={item.title}
                            loading="lazy"
                          />
                        ) : (
                          <div className={styles.recentThumbPlaceholder} />
                        )}
                      </td>
                      <td>
                        <span className={styles.sessionTitle}>{item.title}</span>
                      </td>
                      <td className={styles.qualityCell}>{item.year ?? ""}</td>
                      <td className={styles.qualityCell}>{item.type.charAt(0).toUpperCase() + item.type.slice(1)}</td>
                      <td className={styles.qualityCell}>{formatDate(item.addedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Most Watched This Week */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Most Watched This Week</div>
          {mostWatchedQuery.isLoading && <MostWatchedSkeleton />}
          {mostWatchedQuery.error && (
            <div className={styles.error}>
              Failed to load most watched
              <button className={styles.retryBtn} onClick={() => mostWatchedQuery.refetch()}>
                Retry
              </button>
            </div>
          )}
          {mostWatchedQuery.data && mostWatchedQuery.data.length === 0 && (
            <EmptyState icon="list" title="No watch history this week" />
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
    </PullToRefresh>
  );
}
