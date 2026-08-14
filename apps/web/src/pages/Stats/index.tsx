import type React from "react";
import PullToRefresh from "#components/PullToRefresh";
import { SkeletonLine } from "#components/Skeleton";
import ErrorState from "#components/ErrorState";
import PageShell, { StatusChip } from "#components/PageShell";
import {
  DashboardGrid,
  DashboardLayout,
  SummaryBar,
  SummaryTile,
  TilePicker,
  resolveTiles,
  usePanelOrder,
  type DashboardPanelProps,
  type TileDef,
} from "#components/dashboard";
import { trpc } from "#/trpc";
import { EMPTY, formatBandwidth, formatNumber, formatRelativeShort, formatUptime } from "#/format";
import { LibraryBreakdownPanel } from "./LibraryBreakdownPanel";
import { HistoryPanel } from "./HistoryPanel";
import { MostWatchedPanel } from "./MostWatchedPanel";
import { RecentlyAddedPanel } from "./RecentlyAddedPanel";
import { StreamsPanel } from "./StreamsPanel";
import { SystemPanel } from "./SystemPanel";

// ─── Panel order ────────────────────────────────────────────────────────────

const PANEL_IDS = ["streams", "system", "recentlyAdded", "mostWatched", "history", "libraryBreakdown"] as const;
type PanelId = (typeof PANEL_IDS)[number];

const PANEL_COMPONENTS: Record<PanelId, React.ComponentType<DashboardPanelProps>> = {
  streams: StreamsPanel,
  system: SystemPanel,
  recentlyAdded: RecentlyAddedPanel,
  mostWatched: MostWatchedPanel,
  history: HistoryPanel,
  libraryBreakdown: LibraryBreakdownPanel,
};

// ─── Summary tile config ────────────────────────────────────────────────────

const DEFAULT_TILES = ["streams", "bandwidth", "playsToday", "library", "users"];
const MAX_TILES = 6;

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

  const selectedTiles = resolveTiles(configQuery.data?.stats_summary_tiles, TILE_REGISTRY, DEFAULT_TILES, MAX_TILES);

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
    return <SummaryTile key={id} label={def.label} value={value} sub={sub} />;
  };

  const { order, dragHandleFor, dragPropsFor } = usePanelOrder<PanelId>({
    ids: PANEL_IDS,
    saved: configQuery.data?.stats_panel_order,
    onSave: (next) => saveConfigMutation.mutate({ stats_panel_order: next }),
  });

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
      <PageShell
        chip={
          sessions.length > 0 ? (
            <StatusChip tone="ok" dot>
              {sessions.length} streaming
            </StatusChip>
          ) : undefined
        }
        actions={
          <TilePicker
            registry={TILE_REGISTRY}
            selected={selectedTiles}
            max={MAX_TILES}
            onSave={(next) => saveConfigMutation.mutate({ stats_summary_tiles: next.slice(0, MAX_TILES) })}
          />
        }
      >
        <DashboardLayout>
          {/* ─── Metric tiles ─────────────────────────────────────────── */}
          <SummaryBar>{selectedTiles.map(renderTile)}</SummaryBar>

          {/* ─── Two-column masonry ───────────────────────────────────── */}
          <DashboardGrid>
            {order.map((id, i) => {
              const Panel = PANEL_COMPONENTS[id];
              return <Panel key={id} dragHandle={dragHandleFor(i)} dragProps={dragPropsFor(id, i)} />;
            })}
          </DashboardGrid>
        </DashboardLayout>
      </PageShell>
    </PullToRefresh>
  );
}
