import type React from "react";
import { Link } from "react-router-dom";
import { Loader, Pause, Play, Square } from "lucide-react";
import { ListSkeleton } from "#components/Skeleton";
import { trpc } from "#/trpc";
import styles from "#pages/Stats/Stats.module.css";
import {
  EMPTY,
  formatBandwidth,
  formatChannels,
  formatClock,
  formatCodec,
  formatDuration,
  formatResolution,
} from "#/format";
import SortableTh from "#components/SortableTh";
import { playbackLabel as decisionLabel } from "#lib/streamDecision";
import { useLocalSort } from "#hooks/useLocalSort";
import {
  ColumnPicker,
  PanelCountBadge,
  PanelShell,
  resolveColumns,
  type DashboardPanelProps,
  type PanelColumnDef,
} from "#components/dashboard";

type Session = {
  ratingKey?: string;
  grandparentRatingKey?: string;
  title: string;
  type: string;
  grandparentTitle?: string;
  parentIndex?: number;
  index?: number;
  duration?: number;
  viewOffset?: number;
  user: string;
  player: string;
  product?: string;
  platform?: string;
  state: string;
  local?: boolean;
  relayed?: boolean;
  bandwidth?: number;
  decision: string;
  videoResolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  videoDecision?: string;
  audioDecision?: string;
};

/**
 * The playback marker. A coloured dot said "something is different about this
 * row" without saying what; the transport symbol everyone already reads off a
 * remote control says which. Colour is kept as the secondary signal.
 */
function StateIcon({ state }: { state: string }) {
  const Icon = state === "paused" ? Pause : state === "buffering" ? Loader : state === "playing" ? Play : Square;
  return (
    <span className={styles.stateIcon} data-state={state} title={state}>
      <Icon size={13} strokeWidth={2} fill={state === "buffering" ? "none" : "currentColor"} aria-label={state} />
    </span>
  );
}

function remainingMs(s: Session): number | null {
  if (!s.duration || s.duration <= 0) return null;
  return Math.max(0, s.duration - (s.viewOffset ?? 0));
}

const COLUMN_IDS = [
  "user",
  "quality",
  "audio",
  "playback",
  "bandwidth",
  "device",
  "app",
  "location",
  "remaining",
] as const;
type StreamColumnId = (typeof COLUMN_IDS)[number];
type SortKey = StreamColumnId | "title" | "progress";

type StreamColumn = PanelColumnDef & {
  id: StreamColumnId;
  /** Sort value. Cells render from the session, so this only has to order them. */
  sortValue: (s: Session) => string | number;
  render: (s: Session) => React.ReactNode;
  /** Sorting this column starts descending — the big numbers are the news. */
  descFirst?: boolean;
  /** Dropped on narrow screens, where the panel has room for the essentials only. */
  hideOnMobile?: boolean;
  cellClass?: string;
};

const COLUMNS: StreamColumn[] = [
  {
    id: "user",
    label: "User",
    group: "Who",
    sortValue: (s) => s.user,
    render: (s) => s.user,
    cellClass: styles.userCell,
  },
  {
    id: "quality",
    label: "Quality",
    group: "Stream",
    sortValue: (s) => s.videoResolution ?? "",
    render: (s) =>
      [s.videoResolution ? formatResolution(s.videoResolution) : null, s.videoCodec ? formatCodec(s.videoCodec) : null]
        .filter(Boolean)
        .join(" ") || EMPTY,
    hideOnMobile: true,
  },
  {
    id: "audio",
    label: "Audio",
    group: "Stream",
    sortValue: (s) => s.audioCodec ?? "",
    render: (s) =>
      [s.audioCodec ? formatCodec(s.audioCodec) : null, s.audioChannels ? formatChannels(s.audioChannels) : null]
        .filter(Boolean)
        .join(" ") || EMPTY,
    hideOnMobile: true,
  },
  {
    id: "playback",
    label: "Playback",
    group: "Stream",
    sortValue: (s) => decisionLabel(s, EMPTY),
    render: (s) => decisionLabel(s, EMPTY),
    hideOnMobile: true,
  },
  {
    id: "bandwidth",
    label: "Bandwidth",
    group: "Stream",
    sortValue: (s) => s.bandwidth ?? 0,
    render: (s) => (s.bandwidth ? formatBandwidth(s.bandwidth) : EMPTY),
    descFirst: true,
    hideOnMobile: true,
  },
  {
    id: "device",
    label: "Device",
    group: "Where",
    sortValue: (s) => s.player ?? "",
    render: (s) => s.player || EMPTY,
    hideOnMobile: true,
  },
  {
    id: "app",
    label: "App",
    group: "Where",
    sortValue: (s) => s.product ?? s.platform ?? "",
    render: (s) => s.product || s.platform || EMPTY,
    hideOnMobile: true,
  },
  {
    id: "location",
    label: "Location",
    group: "Where",
    // Relay is worth surfacing above plain remote: it is the mode that runs
    // through plex.tv's servers, and the one that explains a capped bitrate.
    sortValue: (s) => (s.relayed ? "Relay" : s.local ? "Local" : "Remote"),
    render: (s) => (s.relayed ? "Relay" : s.local ? "Local" : "Remote"),
    hideOnMobile: true,
  },
  {
    id: "remaining",
    label: "Left",
    group: "Progress",
    sortValue: (s) => remainingMs(s) ?? Number.MAX_SAFE_INTEGER,
    render: (s) => {
      const left = remainingMs(s);
      return left == null ? EMPTY : formatDuration(left);
    },
    hideOnMobile: true,
  },
];

const PROGRESS_COLUMN_ID = "progress";
const DEFAULT_COLUMNS = ["user", "quality", "bandwidth"];

/** The picker's registry — the toggleable columns plus the two that always show. */
const REGISTRY: PanelColumnDef[] = [
  ...COLUMNS.map(({ id, label, group }) => ({ id, label, group })),
  { id: PROGRESS_COLUMN_ID, label: "Progress", group: "Progress" },
];

export function StreamsPanel({ dragHandle, dragProps }: DashboardPanelProps) {
  const sessionsQuery = trpc.stats.sessions.useQuery(undefined, { refetchInterval: 5000 });
  const allSessions = (sessionsQuery.data ?? []) as Session[];

  const utils = trpc.useUtils();
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const saveConfig = trpc.config.save.useMutation({ onSuccess: () => utils.config.get.invalidate() });

  const visibleIds = resolveColumns(configQuery.data?.stats_streams_columns, REGISTRY, [
    ...DEFAULT_COLUMNS,
    PROGRESS_COLUMN_ID,
  ]);
  const visible = COLUMNS.filter((c) => visibleIds.includes(c.id));
  const showProgress = visibleIds.includes(PROGRESS_COLUMN_ID);

  const {
    sortKey,
    sortDir,
    toggleSort,
    sorted: sessions,
  } = useLocalSort({
    rows: allSessions,
    // Every column is given an accessor, not just the visible ones: hiding the
    // column you were sorting by would otherwise leave the table unsorted.
    accessors: {
      title: (s: Session) => (s.grandparentTitle ? s.grandparentTitle : s.title),
      progress: (s: Session) => (s.duration && s.viewOffset ? s.viewOffset / s.duration : 0),
      ...Object.fromEntries(COLUMNS.map((c) => [c.id, c.sortValue])),
    } as Record<SortKey, (s: Session) => string | number>,
    defaultKey: "title",
    descFirst: ["progress", ...COLUMNS.filter((c) => c.descFirst).map((c) => c.id)],
  });

  return (
    <PanelShell
      title="Active Streams"
      badge={sessions.length > 0 ? <PanelCountBadge>{sessions.length}</PanelCountBadge> : null}
      actions={
        <ColumnPicker
          registry={REGISTRY}
          selected={visibleIds}
          onSave={(ids) => saveConfig.mutate({ stats_streams_columns: ids })}
        />
      }
      dragHandle={dragHandle}
      dragProps={dragProps}
    >
      {sessionsQuery.isLoading && <ListSkeleton rows={3} />}
      {sessionsQuery.error && <div className={styles.error}>Failed to load sessions</div>}
      {!sessionsQuery.isLoading && sessions.length === 0 && <div className={styles.muted}>No active streams</div>}

      {sessions.length > 0 && (
        <div className="table-scroll in-panel" data-scroll="x">
          <table className={styles.compactTable}>
            <thead>
              <tr>
                <th></th>
                <SortableTh sortKey="title" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Title
                </SortableTh>
                {visible.map((col) => (
                  <SortableTh
                    key={col.id}
                    sortKey={col.id}
                    activeKey={sortKey}
                    activeDir={sortDir}
                    onSort={toggleSort}
                    className={col.hideOnMobile ? styles.hideOnMobile : undefined}
                  >
                    {col.label}
                  </SortableTh>
                ))}
                {showProgress && (
                  <SortableTh sortKey="progress" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                    Progress
                  </SortableTh>
                )}
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
                return (
                  <tr key={i}>
                    <td>
                      <StateIcon state={session.state} />
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
                    {visible.map((col) => (
                      <td
                        key={col.id}
                        className={[col.cellClass ?? styles.monoCell, col.hideOnMobile ? styles.hideOnMobile : ""]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {col.render(session)}
                      </td>
                    ))}
                    {showProgress && (
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
                    )}
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
