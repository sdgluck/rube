import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import PullToRefresh from "../PullToRefresh";
import RelativeTime from "../RelativeTime";
import { trpc } from "../trpc";
import { formatDurationMs, stripDurationFromMessage } from "../utils";
import styles from "./Stats.module.css";

// ─── Summary tile config ────────────────────────────────────────────────────

const DEFAULT_TILES = ["streams", "bandwidth", "playsToday", "library", "users"];
const MAX_TILES = 6;

interface TileDef {
  id: string;
  label: string;
  group: string;
}

const TILE_REGISTRY: TileDef[] = [
  { id: "streams", label: "Streams", group: "Live" },
  { id: "transcodes", label: "Transcodes", group: "Live" },
  { id: "bandwidth", label: "Bandwidth", group: "Live" },
  { id: "playsToday", label: "Plays Today", group: "Activity" },
  { id: "playsWeek", label: "Plays (7d)", group: "Activity" },
  { id: "topUserToday", label: "Top User Today", group: "Activity" },
  { id: "library", label: "Library", group: "Library" },
  { id: "addedThisWeek", label: "Added (7d)", group: "Library" },
  { id: "pct4k", label: "4K Library", group: "Library" },
  { id: "librarySplit", label: "Movies / Episodes", group: "Library" },
  { id: "users", label: "Users", group: "Users" },
  { id: "activeUsers", label: "Active Users (7d)", group: "Users" },
  { id: "failedJobs", label: "Failed Jobs (24h)", group: "Ops" },
  { id: "lastSync", label: "Last Sync", group: "Ops" },
  { id: "uptime", label: "Uptime", group: "Ops" },
];

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function formatRelativeShort(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

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

// ─── Tile picker ────────────────────────────────────────────────────────────

function TilePicker({ selected, onSave }: { selected: string[]; onSave: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(selected), [selected.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggle = (id: string) => {
    setDraft((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_TILES) return prev;
      return [...prev, id];
    });
  };

  const move = (from: number, to: number) => {
    setDraft((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const dragIndex = useRef<number | null>(null);

  const groups: Record<string, TileDef[]> = {};
  for (const t of TILE_REGISTRY) {
    (groups[t.group] ||= []).push(t);
  }

  return (
    <div className={styles.tilePicker} ref={ref}>
      <button
        className={styles.tilePickerButton}
        onClick={() => setOpen((v) => !v)}
        title="Customize tiles"
        aria-label="Customize tiles"
      >
        ⚙
      </button>
      {open && (
        <div className={styles.tilePickerPopover}>
          <div className={styles.tilePickerHeader}>
            <span>Choose up to {MAX_TILES} tiles</span>
            <span className={styles.tilePickerCount}>
              {draft.length} / {MAX_TILES}
            </span>
          </div>
          {draft.length > 0 && (
            <div className={styles.tilePickerOrder}>
              <div className={styles.tilePickerGroupLabel}>Order (drag or use arrows)</div>
              {draft.map((id, i) => {
                const def = TILE_REGISTRY.find((t) => t.id === id);
                if (!def) return null;
                return (
                  <div
                    key={id}
                    className={styles.tilePickerOrderItem}
                    draggable
                    onDragStart={(e) => {
                      dragIndex.current = i;
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = dragIndex.current;
                      dragIndex.current = null;
                      if (from == null || from === i) return;
                      move(from, i);
                    }}
                  >
                    <span className={styles.tilePickerHandle} aria-hidden>
                      ⋮⋮
                    </span>
                    <span className={styles.tilePickerOrderLabel}>{def.label}</span>
                    <button
                      className={styles.tilePickerArrow}
                      onClick={() => move(i, i - 1)}
                      disabled={i === 0}
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      className={styles.tilePickerArrow}
                      onClick={() => move(i, i + 1)}
                      disabled={i === draft.length - 1}
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button className={styles.tilePickerRemove} onClick={() => toggle(id)} aria-label="Remove">
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className={styles.tilePickerList}>
            {Object.entries(groups).map(([group, items]) => (
              <div key={group} className={styles.tilePickerGroup}>
                <div className={styles.tilePickerGroupLabel}>{group}</div>
                {items.map((t) => {
                  const isSel = draft.includes(t.id);
                  const disabled = !isSel && draft.length >= MAX_TILES;
                  return (
                    <label
                      key={t.id}
                      className={`${styles.tilePickerOption} ${disabled ? styles.tilePickerOptionDisabled : ""}`}
                    >
                      <input type="checkbox" checked={isSel} disabled={disabled} onChange={() => toggle(t.id)} />
                      <span>{t.label}</span>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
          <div className={styles.tilePickerActions}>
            <button
              className={styles.tilePickerSave}
              onClick={() => {
                onSave(draft);
                setOpen(false);
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function Stats() {
  const sessionsQuery = trpc.stats.sessions.useQuery(undefined, { refetchInterval: 5000 });
  const recentQuery = trpc.stats.recentlyAdded.useQuery();
  const mostWatchedQuery = trpc.stats.mostWatched.useQuery();
  const overviewQuery = trpc.stats.overview.useQuery();
  const activityQuery = trpc.stats.activity.useQuery();
  const opsQuery = trpc.stats.ops.useQuery(undefined, { refetchInterval: 30000 });
  const healthQuery = trpc.health.status.useQuery();
  const activeJobsQuery = trpc.jobs.activeRuns.useQuery(undefined, { refetchInterval: 10000 });
  const eventsQuery = trpc.events.list.useQuery({ limit: 5 });
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const utils = trpc.useUtils();
  const saveConfigMutation = trpc.config.save.useMutation({
    onSuccess: () => utils.config.get.invalidate(),
  });

  const sessions = sessionsQuery.data ?? [];
  const totalBandwidth = sessions.reduce((sum, s) => sum + (s.bandwidth ?? 0), 0);
  const transcodingCount = sessions.filter((s) => s.videoDecision === "transcode").length;

  const selectedTiles =
    configQuery.data?.stats_summary_tiles && configQuery.data.stats_summary_tiles.length > 0
      ? configQuery.data.stats_summary_tiles.filter((id) => TILE_REGISTRY.some((t) => t.id === id)).slice(0, MAX_TILES)
      : DEFAULT_TILES;

  const handleRefresh = () => {
    sessionsQuery.refetch();
    recentQuery.refetch();
    mostWatchedQuery.refetch();
    overviewQuery.refetch();
    activityQuery.refetch();
    opsQuery.refetch();
    healthQuery.refetch();
    activeJobsQuery.refetch();
    eventsQuery.refetch();
  };

  const renderTile = (id: string): React.ReactNode => {
    const def = TILE_REGISTRY.find((t) => t.id === id);
    if (!def) return null;
    let value: React.ReactNode = "—";
    let sub: React.ReactNode = null;
    switch (id) {
      case "streams":
        value = sessionsQuery.isLoading ? "—" : sessions.length;
        if (transcodingCount > 0) sub = `${transcodingCount} transcoding`;
        break;
      case "transcodes":
        value = sessionsQuery.isLoading ? "—" : transcodingCount;
        if (sessions.length > 0) sub = `of ${sessions.length}`;
        break;
      case "bandwidth":
        value = sessionsQuery.isLoading ? "—" : totalBandwidth > 0 ? formatBandwidth(totalBandwidth) : "—";
        break;
      case "playsToday":
        value = activityQuery.isLoading ? "—" : (activityQuery.data?.playsToday ?? 0);
        if (activityQuery.data && activityQuery.data.playsWeek > 0) sub = `${activityQuery.data.playsWeek} this week`;
        break;
      case "playsWeek":
        value = activityQuery.isLoading ? "—" : (activityQuery.data?.playsWeek ?? 0);
        break;
      case "topUserToday": {
        const u = activityQuery.data?.topUserToday;
        value = u ? u.name : "—";
        sub = u ? `${u.plays} ${u.plays === 1 ? "play" : "plays"}` : null;
        break;
      }
      case "library":
        value = overviewQuery.isLoading ? "—" : formatNumber(overviewQuery.data?.totalItems ?? 0);
        if (overviewQuery.data && overviewQuery.data.addedThisWeek > 0)
          sub = `+${overviewQuery.data.addedThisWeek} this week`;
        break;
      case "addedThisWeek":
        value = overviewQuery.isLoading ? "—" : (overviewQuery.data?.addedThisWeek ?? 0);
        break;
      case "pct4k": {
        const total = overviewQuery.data?.totalItems ?? 0;
        const c4k = overviewQuery.data?.count4k ?? 0;
        value = overviewQuery.isLoading ? "—" : total > 0 ? `${Math.round((c4k / total) * 100)}%` : "—";
        if (c4k > 0) sub = `${formatNumber(c4k)} items`;
        break;
      }
      case "librarySplit": {
        const m = overviewQuery.data?.movieCount ?? 0;
        const e = overviewQuery.data?.episodeCount ?? 0;
        value = overviewQuery.isLoading ? "—" : `${formatNumber(m)} / ${formatNumber(e)}`;
        sub = "Movies / Episodes";
        break;
      }
      case "users":
        value = overviewQuery.isLoading ? "—" : (overviewQuery.data?.userCount ?? 0);
        if (activityQuery.data && activityQuery.data.activeUsersWeek > 0)
          sub = `${activityQuery.data.activeUsersWeek} active`;
        break;
      case "activeUsers":
        value = activityQuery.isLoading ? "—" : (activityQuery.data?.activeUsersWeek ?? 0);
        sub = "this week";
        break;
      case "failedJobs": {
        const n = opsQuery.data?.failedJobs24h ?? 0;
        value = opsQuery.isLoading ? "—" : n;
        if (n > 0) sub = "needs attention";
        break;
      }
      case "lastSync":
        value = opsQuery.data?.lastSyncAt ? formatRelativeShort(opsQuery.data.lastSyncAt) : "—";
        break;
      case "uptime":
        value = opsQuery.data?.uptimeSec != null ? formatUptime(opsQuery.data.uptimeSec) : "—";
        break;
    }
    return (
      <div className={styles.summaryItem} key={id}>
        <span className={styles.summaryLabel}>{def.label}</span>
        <span className={styles.summaryValue}>
          {value}
          {sub != null && <span className={styles.summarySub}>{sub}</span>}
        </span>
      </div>
    );
  };

  const saveTiles = (next: string[]) => {
    saveConfigMutation.mutate({ stats_summary_tiles: next.slice(0, MAX_TILES) });
  };

  const maxPlays = mostWatchedQuery.data?.[0]?.plays ?? 1;

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className={styles.dashboard}>
        {/* ─── Summary Bar ──────────────────────────────────────────── */}
        <div className={styles.summaryBar}>
          {selectedTiles.flatMap((id, i) => {
            const nodes: React.ReactNode[] = [];
            if (i > 0) nodes.push(<div key={`d-${id}`} className={styles.summaryDivider} />);
            nodes.push(renderTile(id));
            return nodes;
          })}
          <TilePicker selected={selectedTiles} onSave={saveTiles} />
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
              <div className={styles.jobsBody}>
                {activeJobsQuery.data && activeJobsQuery.data.length > 0 ? (
                  activeJobsQuery.data.map((run) => (
                    <div key={run.id} className={styles.jobRow}>
                      <span className={styles.spinner} />
                      <span className={styles.jobName}>{run.jobId}</span>
                      {run.progress > 0 && (
                        <span className={styles.jobProgress}>{Math.round(run.progress * 100)}%</span>
                      )}
                    </div>
                  ))
                ) : (
                  <div className={`${styles.muted} ${styles.jobsEmpty}`}>No active jobs</div>
                )}
              </div>
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
