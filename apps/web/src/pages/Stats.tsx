import { Link } from "react-router-dom";
import PullToRefresh from "../PullToRefresh";
import RelativeTime from "../RelativeTime";
import { trpc } from "../trpc";
import { formatDurationMs, stripDurationFromMessage } from "../utils";
import styles from "./Stats.module.css";

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Distribution bar ───────────────────────────────────────────────────────

const RESOLUTION_COLORS: Record<string, string> = {
  "4k": "#7c4dff",
  "1080": "#4a6cf7",
  "720": "#28a745",
  "480": "#f5c518",
  sd: "#888",
};

const CODEC_COLORS = ["#7c4dff", "#4a6cf7", "#28a745", "#f5c518", "#ef4444", "#888"];

interface DistItem {
  value: string | null;
  count: number;
}

function DistributionBar({
  label,
  items,
  colorMap,
  formatLabel,
}: {
  label: string;
  items: DistItem[];
  colorMap?: Record<string, string>;
  formatLabel?: (v: string) => string;
}) {
  const sorted = [...items].sort((a, b) => b.count - a.count);
  const total = sorted.reduce((s, i) => s + i.count, 0);
  if (total === 0) return null;

  return (
    <div className={styles.distRow}>
      <span className={styles.distLabel}>{label}</span>
      <div className={styles.distBar}>
        {sorted.map((item, i) => {
          const pct = (item.count / total) * 100;
          if (pct < 1) return null;
          const color = colorMap?.[item.value ?? ""] ?? CODEC_COLORS[i % CODEC_COLORS.length];
          const displayLabel = formatLabel ? formatLabel(item.value ?? "") : (item.value ?? "?");
          return (
            <div
              key={item.value ?? i}
              className={styles.distSegment}
              style={{ width: `${pct}%`, background: color }}
              title={`${displayLabel}: ${item.count} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className={styles.distLegend}>
        {sorted.slice(0, 5).map((item, i) => {
          const color = colorMap?.[item.value ?? ""] ?? CODEC_COLORS[i % CODEC_COLORS.length];
          const displayLabel = formatLabel ? formatLabel(item.value ?? "") : (item.value ?? "?");
          return (
            <span key={item.value ?? i} className={styles.distLegendItem}>
              <span className={styles.distLegendDot} style={{ background: color }} />
              {displayLabel}
              <span className={styles.distLegendCount}>{item.count}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function Stats() {
  const sessionsQuery = trpc.stats.sessions.useQuery(undefined, { refetchInterval: 5000 });
  const recentQuery = trpc.stats.recentlyAdded.useQuery();
  const mostWatchedQuery = trpc.stats.mostWatched.useQuery();
  const overviewQuery = trpc.stats.overview.useQuery();
  const healthQuery = trpc.health.status.useQuery();
  const activeJobsQuery = trpc.jobs.activeRuns.useQuery(undefined, { refetchInterval: 10000 });
  const eventsQuery = trpc.events.list.useQuery({ limit: 5 });

  const sessions = sessionsQuery.data ?? [];
  const totalBandwidth = sessions.reduce((sum, s) => sum + (s.bandwidth ?? 0), 0);

  const handleRefresh = () => {
    sessionsQuery.refetch();
    recentQuery.refetch();
    mostWatchedQuery.refetch();
    overviewQuery.refetch();
    healthQuery.refetch();
    activeJobsQuery.refetch();
    eventsQuery.refetch();
  };

  const maxPlays = mostWatchedQuery.data?.[0]?.plays ?? 1;

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className={styles.dashboard}>
        {/* ─── Summary Bar ──────────────────────────────────────────── */}
        <div className={styles.summaryBar}>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Streams</span>
            <span className={styles.summaryValue}>{sessionsQuery.isLoading ? "—" : sessions.length}</span>
          </div>
          <div className={styles.summaryDivider} />
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Bandwidth</span>
            <span className={styles.summaryValue}>
              {sessionsQuery.isLoading ? "—" : totalBandwidth > 0 ? formatBandwidth(totalBandwidth) : "—"}
            </span>
          </div>
          <div className={styles.summaryDivider} />
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Library</span>
            <span className={styles.summaryValue}>
              {overviewQuery.isLoading ? "—" : formatNumber(overviewQuery.data?.totalItems ?? 0)}
            </span>
          </div>
          <div className={styles.summaryDivider} />
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Users</span>
            <span className={styles.summaryValue}>
              {overviewQuery.isLoading ? "—" : (overviewQuery.data?.userCount ?? 0)}
            </span>
          </div>
        </div>

        {/* ─── Two-column grid ──────────────────────────────────────── */}
        <div className={styles.grid}>
          {/* ─── Active Streams ──────────────────────────────────────── */}
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              Active Streams
              {sessions.length > 0 && <span className={styles.countBadge}>{sessions.length}</span>}
            </div>

            {sessionsQuery.isLoading && <div className={styles.muted}>Loading…</div>}
            {sessionsQuery.error && <div className={styles.error}>Failed to load sessions</div>}
            {!sessionsQuery.isLoading && sessions.length === 0 && <div className={styles.muted}>No active streams</div>}

            {sessions.length > 0 && (
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
                          <span className={styles.titleText}>
                            {title}
                            {epInfo && <span className={styles.epLabel}> · {epInfo}</span>}
                          </span>
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
                              title={`${formatDuration(session.viewOffset ?? 0)} / ${formatDuration(session.duration)}`}
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
            )}
          </div>

          {/* ─── System Status ───────────────────────────────────────── */}
          <div className={styles.panel}>
            <div className={styles.panelHeader}>System Status</div>

            {/* Health */}
            {healthQuery.data && (
              <div className={styles.healthRow}>
                {healthQuery.data
                  .filter((s) => s.configured)
                  .map((svc) => (
                    <span key={svc.service} className={styles.healthItem} title={svc.message ?? ""}>
                      <span className={styles.healthDot} data-status={svc.status ?? "unknown"} />
                      {svc.service}
                    </span>
                  ))}
              </div>
            )}

            {/* Active jobs */}
            <div className={styles.subSection}>
              <div className={styles.subHeader}>Jobs</div>
              {activeJobsQuery.data && activeJobsQuery.data.length > 0 ? (
                activeJobsQuery.data.map((run) => (
                  <div key={run.id} className={styles.jobRow}>
                    <span className={styles.spinner} />
                    <span className={styles.jobName}>{run.jobId}</span>
                    {run.progress > 0 && <span className={styles.jobProgress}>{Math.round(run.progress * 100)}%</span>}
                  </div>
                ))
              ) : (
                <div className={styles.muted}>No active jobs</div>
              )}
            </div>

            {/* Recent events */}
            <div className={styles.subSection}>
              <div className={styles.subHeader}>Recent Events</div>
              {eventsQuery.data && eventsQuery.data.items.length > 0 ? (
                eventsQuery.data.items.map((event) => (
                  <div key={event.id} className={styles.eventRow}>
                    <span className={styles.eventTime}>
                      <RelativeTime timestamp={event.timestamp} />
                    </span>
                    <span className={styles.eventMsg}>
                      {event.count > 1 ? <strong>{event.count}× </strong> : null}
                      {event.count > 1 && event.avgDurationMs != null
                        ? stripDurationFromMessage(event.message)
                        : event.message}
                      {event.count > 1 && event.avgDurationMs != null && (
                        <span className={styles.muted}> (avg {formatDurationMs(event.avgDurationMs)})</span>
                      )}
                    </span>
                  </div>
                ))
              ) : (
                <div className={styles.muted}>No recent events</div>
              )}
            </div>
          </div>

          {/* ─── Recently Added ──────────────────────────────────────── */}
          <div className={styles.panel}>
            <div className={styles.panelHeader}>Recently Added</div>
            {recentQuery.isLoading && <div className={styles.muted}>Loading…</div>}
            {recentQuery.data && recentQuery.data.items.length === 0 && (
              <div className={styles.muted}>No recently added media</div>
            )}
            {recentQuery.data && recentQuery.data.items.length > 0 && (
              <table className={styles.compactTable}>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Type</th>
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
                        <td className={styles.monoCell}>
                          <RelativeTime timestamp={item.addedAt} seconds />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* ─── Most Watched ────────────────────────────────────────── */}
          <div className={styles.panel}>
            <div className={styles.panelHeader}>Most Watched This Week</div>
            {mostWatchedQuery.isLoading && <div className={styles.muted}>Loading…</div>}
            {mostWatchedQuery.data && mostWatchedQuery.data.length === 0 && (
              <div className={styles.muted}>No watch history this week</div>
            )}
            {mostWatchedQuery.data && mostWatchedQuery.data.length > 0 && (
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
            )}
          </div>
          {/* ─── Library Breakdown ──────────────────────────────────── */}
          {overviewQuery.data && overviewQuery.data.totalItems > 0 && (
            <div className={styles.panel}>
              <div className={styles.panelHeader}>Library Breakdown</div>
              <div className={styles.distRows}>
                <DistributionBar
                  label="Resolution"
                  items={overviewQuery.data.resolutions}
                  colorMap={RESOLUTION_COLORS}
                  formatLabel={formatResolution}
                />
                <DistributionBar label="Video Codec" items={overviewQuery.data.videoCodecs} formatLabel={formatCodec} />
                <DistributionBar label="Audio Codec" items={overviewQuery.data.audioCodecs} formatLabel={formatCodec} />
              </div>
            </div>
          )}
        </div>
      </div>
    </PullToRefresh>
  );
}
