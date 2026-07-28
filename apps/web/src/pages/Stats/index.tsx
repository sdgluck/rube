import { LayoutGrid } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import PullToRefresh from "#components/PullToRefresh";
import { SkeletonLine } from "#components/Skeleton";
import ErrorState from "#components/ErrorState";
import { trpc } from "#/trpc";
import { EMPTY, formatBandwidth, formatNumber, formatRelativeShort, formatUptime } from "#/format";
import { DragHandle, type PanelDragProps } from "./PanelShell";
import { LibraryBreakdownPanel } from "./LibraryBreakdownPanel";
import { MostWatchedPanel } from "./MostWatchedPanel";
import { RecentlyAddedPanel } from "./RecentlyAddedPanel";
import { StreamsPanel } from "./StreamsPanel";
import { SystemPanel } from "./SystemPanel";
import styles from "./Stats.module.css";

// ─── Panel order ────────────────────────────────────────────────────────────

const PANEL_IDS = ["streams", "system", "recentlyAdded", "mostWatched", "libraryBreakdown"] as const;
type PanelId = (typeof PANEL_IDS)[number];
const DEFAULT_PANEL_ORDER: PanelId[] = [...PANEL_IDS];

const PANEL_COMPONENTS: Record<
  PanelId,
  React.ComponentType<{ dragHandle: React.ReactNode; dragProps: PanelDragProps }>
> = {
  streams: StreamsPanel,
  system: SystemPanel,
  recentlyAdded: RecentlyAddedPanel,
  mostWatched: MostWatchedPanel,
  libraryBreakdown: LibraryBreakdownPanel,
};

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
        <LayoutGrid size={16} strokeWidth={2} />
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
  // Queries needed for the summary tile bar.
  const sessionsQuery = trpc.stats.sessions.useQuery(undefined, { refetchInterval: 5000 });
  const overviewQuery = trpc.stats.overview.useQuery();
  const activityQuery = trpc.stats.activity.useQuery();
  const opsQuery = trpc.stats.ops.useQuery(undefined, { refetchInterval: 30000 });

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
    utils.stats.invalidate();
    utils.health.invalidate();
    utils.jobs.invalidate();
    utils.events.invalidate();
  };

  const renderTile = (id: string): React.ReactNode => {
    const def = TILE_REGISTRY.find((t) => t.id === id);
    if (!def) return null;
    let value: React.ReactNode = EMPTY;
    let sub: React.ReactNode = null;
    switch (id) {
      case "streams":
        value = sessionsQuery.isLoading ? <SkeletonLine width="40px" /> : sessions.length;
        if (transcodingCount > 0) sub = `${transcodingCount} transcoding`;
        break;
      case "transcodes":
        value = sessionsQuery.isLoading ? <SkeletonLine width="40px" /> : transcodingCount;
        if (sessions.length > 0) sub = `of ${sessions.length}`;
        break;
      case "bandwidth":
        value = sessionsQuery.isLoading ? (
          <SkeletonLine width="40px" />
        ) : totalBandwidth > 0 ? (
          formatBandwidth(totalBandwidth)
        ) : (
          EMPTY
        );
        break;
      case "playsToday":
        value = activityQuery.isLoading ? <SkeletonLine width="40px" /> : (activityQuery.data?.playsToday ?? 0);
        if (activityQuery.data && activityQuery.data.playsWeek > 0) sub = `${activityQuery.data.playsWeek} this week`;
        break;
      case "playsWeek":
        value = activityQuery.isLoading ? <SkeletonLine width="40px" /> : (activityQuery.data?.playsWeek ?? 0);
        break;
      case "topUserToday": {
        const u = activityQuery.data?.topUserToday;
        value = u ? u.name : EMPTY;
        sub = u ? `${u.plays} ${u.plays === 1 ? "play" : "plays"}` : null;
        break;
      }
      case "library":
        value = overviewQuery.isLoading ? (
          <SkeletonLine width="40px" />
        ) : (
          formatNumber(overviewQuery.data?.totalItems ?? 0)
        );
        if (overviewQuery.data && overviewQuery.data.addedThisWeek > 0)
          sub = `+${overviewQuery.data.addedThisWeek} this week`;
        break;
      case "addedThisWeek":
        value = overviewQuery.isLoading ? <SkeletonLine width="40px" /> : (overviewQuery.data?.addedThisWeek ?? 0);
        break;
      case "pct4k": {
        const total = overviewQuery.data?.totalItems ?? 0;
        const c4k = overviewQuery.data?.count4k ?? 0;
        value = overviewQuery.isLoading ? (
          <SkeletonLine width="40px" />
        ) : total > 0 ? (
          `${Math.round((c4k / total) * 100)}%`
        ) : (
          EMPTY
        );
        if (c4k > 0) sub = `${formatNumber(c4k)} items`;
        break;
      }
      case "librarySplit": {
        const m = overviewQuery.data?.movieCount ?? 0;
        const e = overviewQuery.data?.episodeCount ?? 0;
        value = overviewQuery.isLoading ? <SkeletonLine width="40px" /> : `${formatNumber(m)} / ${formatNumber(e)}`;
        sub = "Movies / Episodes";
        break;
      }
      case "users":
        value = overviewQuery.isLoading ? <SkeletonLine width="40px" /> : (overviewQuery.data?.userCount ?? 0);
        if (activityQuery.data && activityQuery.data.activeUsersWeek > 0)
          sub = `${activityQuery.data.activeUsersWeek} active`;
        break;
      case "activeUsers":
        value = activityQuery.isLoading ? <SkeletonLine width="40px" /> : (activityQuery.data?.activeUsersWeek ?? 0);
        sub = "this week";
        break;
      case "failedJobs": {
        const n = opsQuery.data?.failedJobs24h ?? 0;
        value = opsQuery.isLoading ? <SkeletonLine width="40px" /> : n;
        if (n > 0) sub = "needs attention";
        break;
      }
      case "lastSync":
        value = opsQuery.data?.lastSyncAt ? formatRelativeShort(opsQuery.data.lastSyncAt) : EMPTY;
        break;
      case "uptime":
        value = opsQuery.data?.uptimeSec != null ? formatUptime(opsQuery.data.uptimeSec) : EMPTY;
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

  // ─── Panel reordering ───────────────────────────────────────────────────
  const savedPanelOrder = configQuery.data?.stats_panel_order;
  const resolvedPanelOrder = useMemo<PanelId[]>(() => {
    const known = new Set(PANEL_IDS as readonly string[]);
    const seen = new Set<string>();
    const out: PanelId[] = [];
    for (const id of savedPanelOrder ?? []) {
      if (known.has(id) && !seen.has(id)) {
        out.push(id as PanelId);
        seen.add(id);
      }
    }
    for (const id of DEFAULT_PANEL_ORDER) {
      if (!seen.has(id)) out.push(id);
    }
    return out;
  }, [savedPanelOrder?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const [panelOrder, setPanelOrder] = useState<PanelId[]>(resolvedPanelOrder);
  useEffect(() => setPanelOrder(resolvedPanelOrder), [resolvedPanelOrder]);

  const panelDragIndex = useRef<number | null>(null);
  const [dragOverPanel, setDragOverPanel] = useState<PanelId | null>(null);

  const movePanel = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= panelOrder.length || to >= panelOrder.length) return;
    const next = [...panelOrder];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setPanelOrder(next);
    saveConfigMutation.mutate({ stats_panel_order: next });
  };

  const buildDragProps = (id: PanelId, index: number): PanelDragProps => ({
    onDragOver: (e) => {
      if (panelDragIndex.current == null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragOverPanel !== id) setDragOverPanel(id);
    },
    onDragLeave: () => {
      if (dragOverPanel === id) setDragOverPanel(null);
    },
    onDrop: (e) => {
      e.preventDefault();
      const from = panelDragIndex.current;
      panelDragIndex.current = null;
      setDragOverPanel(null);
      if (from == null) return;
      movePanel(from, index);
    },
    "data-drag-over": dragOverPanel === id ? "true" : undefined,
  });

  const buildDragHandle = (index: number) => (
    <DragHandle
      onDragStart={(e) => {
        panelDragIndex.current = index;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(index));
      }}
      onDragEnd={() => {
        panelDragIndex.current = null;
        setDragOverPanel(null);
      }}
    />
  );

  // Individual panels report their own failures. When every core stat query is
  // down the server itself is unreachable, and a page of empty panels reads as
  // "your library is empty" — so say what actually happened instead.
  const coreQueries = [sessionsQuery, overviewQuery, activityQuery, opsQuery];
  if (coreQueries.every((q) => q.isError)) {
    return (
      <ErrorState title="Couldn't reach the Tinkerbell server" error={overviewQuery.error} onRetry={handleRefresh} />
    );
  }

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className={styles.dashboard}>
        {/* The dashboard's identity is obvious on screen from the tiles and
            panels; the heading exists so the page has one for screen readers
            and document outline. */}
        <h2 className="sr-only">Stats</h2>
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
          {panelOrder.map((id, i) => {
            const Panel = PANEL_COMPONENTS[id];
            return <Panel key={id} dragHandle={buildDragHandle(i)} dragProps={buildDragProps(id, i)} />;
          })}
        </div>
      </div>
    </PullToRefresh>
  );
}
