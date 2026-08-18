import type React from "react";
import PullToRefresh from "#components/PullToRefresh";
import { SkeletonLine } from "#components/Skeleton";
import ErrorState from "#components/ErrorState";
import PageShell, { StatusChip } from "#components/PageShell";
import SetupCard from "./SetupCard";
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
import {
  EMPTY,
  formatBandwidth,
  formatFileSize,
  formatMbps,
  formatNumber,
  formatRelativeShort,
  formatUptime,
} from "#/format";
import { LibraryBreakdownPanel } from "./LibraryBreakdownPanel";
import { isTranscoding, streamKind } from "#lib/streamDecision";
import { HistoryPanel } from "./HistoryPanel";
import { MostWatchedPanel } from "./MostWatchedPanel";
import { RecentlyAddedPanel } from "./RecentlyAddedPanel";
import { StreamsPanel } from "./StreamsPanel";
import { StoragePanel } from "./StoragePanel";
import { SystemPanel } from "./SystemPanel";

// ─── Panel order ────────────────────────────────────────────────────────────

const PANEL_IDS = [
  "streams",
  "system",
  "recentlyAdded",
  "mostWatched",
  "history",
  "libraryBreakdown",
  "storage",
] as const;
type PanelId = (typeof PANEL_IDS)[number];

const PANEL_COMPONENTS: Record<PanelId, React.ComponentType<DashboardPanelProps>> = {
  streams: StreamsPanel,
  system: SystemPanel,
  recentlyAdded: RecentlyAddedPanel,
  mostWatched: MostWatchedPanel,
  history: HistoryPanel,
  libraryBreakdown: LibraryBreakdownPanel,
  storage: StoragePanel,
};

// ─── Summary tile config ────────────────────────────────────────────────────

const DEFAULT_TILES = ["streams", "bandwidth", "playsToday", "library", "users"];
/**
 * The row is `auto-fit` over a 158px minimum, so tiles past the first line wrap
 * rather than squeezing — ten fills two comfortable rows on a laptop and stays
 * legible on a phone, where the minimum drops to 104px.
 */
const MAX_TILES = 10;

const TILE_REGISTRY: TileDef[] = [
  { id: "streams", label: "Streams", group: "Live" },
  { id: "transcodes", label: "Transcodes", group: "Live" },
  { id: "directPlay", label: "Direct Play", group: "Live" },
  { id: "paused", label: "Paused", group: "Live" },
  { id: "remoteStreams", label: "Remote Streams", group: "Live" },
  { id: "bandwidth", label: "Bandwidth", group: "Live" },
  { id: "playsToday", label: "Plays Today", group: "Activity" },
  { id: "playsWeek", label: "Plays (7d)", group: "Activity" },
  { id: "topUserToday", label: "Top User Today", group: "Activity" },
  { id: "library", label: "Library", group: "Library" },
  { id: "storage", label: "Storage", group: "Library" },
  { id: "addedThisWeek", label: "Added (7d)", group: "Library" },
  { id: "pct4k", label: "4K Library", group: "Library" },
  { id: "librarySplit", label: "Movies / Episodes", group: "Library" },
  { id: "shows", label: "Shows", group: "Library" },
  { id: "users", label: "Users", group: "Users" },
  { id: "activeUsers", label: "Active Users (7d)", group: "Users" },
  { id: "failedJobs", label: "Failed Jobs (24h)", group: "Ops" },
  { id: "lastSync", label: "Last Sync", group: "Ops" },
  { id: "uptime", label: "Uptime", group: "Ops" },
];

// ─── Main component ─────────────────────────────────────────────────────────

export default function Stats() {
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const selectedTiles = resolveTiles(configQuery.data?.stats_summary_tiles, TILE_REGISTRY, DEFAULT_TILES, MAX_TILES);

  // Queries needed for the summary tile bar.
  const sessionsQuery = trpc.stats.sessions.useQuery(undefined, { refetchInterval: 5000 });
  const overviewQuery = trpc.stats.overview.useQuery();
  const activityQuery = trpc.stats.activity.useQuery();
  const opsQuery = trpc.stats.ops.useQuery(undefined, { refetchInterval: 30000 });
  // Not polled: this changes only when someone runs a bandwidth test.
  const bandwidthQuery = trpc.bandwidth.latest.useQuery(undefined, { refetchOnWindowFocus: false });

  // The two sparkline series, each fetched only when a tile is showing it —
  // they are the only queries on this page nothing else on it needs, and both
  // poll. Six tiles out of fifteen, so most loads skip both.
  //
  // Fourteen days of daily plays: a fortnight is two weekends, the shortest
  // window where "quiet Tuesday" and "nobody has watched anything since
  // Friday" look different.
  const activitySeriesQuery = trpc.stats.activitySeries.useQuery(
    { days: 14 },
    { enabled: selectedTiles.includes("playsToday") || selectedTiles.includes("playsWeek") },
  );
  // A day of usage in hourly peaks. Refetched on the minute rather than with
  // the 5s session poll: a bucket is an hour wide, so anything faster redraws
  // an identical line.
  const bandwidthUsageQuery = trpc.bandwidth.usage.useQuery(
    { hours: 24, buckets: 24 },
    { enabled: selectedTiles.includes("bandwidth"), refetchInterval: 60_000, refetchOnWindowFocus: false },
  );
  // Not gated on the tile being shown, unlike the two above: the Storage panel
  // asks for the same thing on every load, so the tile joins an existing cache
  // entry rather than adding a request. It doesn't poll — it changes on a sync.
  const storageQuery = trpc.stats.storage.useQuery(undefined, { refetchOnWindowFocus: false });

  const utils = trpc.useUtils();
  const saveConfigMutation = trpc.config.save.useMutation({
    onSuccess: () => utils.config.get.invalidate(),
  });

  const sessions = sessionsQuery.data ?? [];
  const totalBandwidth = sessions.reduce((sum, s) => sum + (s.bandwidth ?? 0), 0);
  // One classifier for the whole page — see `streamDecision`. The tiles used to
  // count `videoDecision` alone, so an audio-only transcode read "0 transcoding"
  // here while the row beneath said "Transcode (audio)".
  const transcodingCount = sessions.filter(isTranscoding).length;
  const directPlayCount = sessions.filter((s) => streamKind(s) === "direct-play").length;
  const series = activitySeriesQuery.data;

  const handleRefresh = () => {
    utils.stats.invalidate();
    utils.health.invalidate();
    utils.bandwidth.invalidate();
    utils.jobs.invalidate();
    utils.events.invalidate();
  };

  const renderTile = (id: string): React.ReactNode => {
    const def = TILE_REGISTRY.find((t) => t.id === id);
    if (!def) return null;
    let value: React.ReactNode = EMPTY;
    let sub: React.ReactNode = null;
    let tone: "small" | "accent" | "danger" | undefined;
    let trend: number[] | undefined;
    // Where this tile is explained in full. Set only when the destination is
    // filtered down to what the tile counts — the panels below cover streams,
    // plays and recently-added, so those tiles stay where they are.
    let to: string | undefined;
    switch (id) {
      case "streams":
        value = sessionsQuery.isLoading ? <SkeletonLine width="40px" /> : sessions.length;
        if (transcodingCount > 0) sub = `${transcodingCount} transcoding`;
        break;
      case "transcodes":
        value = sessionsQuery.isLoading ? <SkeletonLine width="40px" /> : transcodingCount;
        if (sessions.length > 0) sub = `of ${sessions.length}`;
        break;
      case "directPlay": {
        // The number worth watching on a server that transcodes: how much of the
        // load is the CPU's problem. Not simply "everything that isn't
        // transcoding" — a remux is a Direct Stream, which Plex reports
        // separately and the Streams panel labels as such, so counting it here
        // as direct play made the two disagree about the same session.
        value = sessionsQuery.isLoading ? <SkeletonLine width="40px" /> : directPlayCount;
        if (sessions.length > 0) sub = `of ${sessions.length}`;
        break;
      }
      case "paused": {
        const paused = sessions.filter((s) => s.state === "paused").length;
        value = sessionsQuery.isLoading ? <SkeletonLine width="40px" /> : paused;
        // A paused stream still holds a session, which is what makes it worth
        // its own tile: the Streams count includes it and looks like demand.
        if (sessions.length > 0) sub = `of ${sessions.length}`;
        break;
      }
      case "remoteStreams": {
        // `local === false`, not `!local`: Plex omits the flag on some clients,
        // and an unknown location counted as remote would overstate the figure
        // this tile exists to watch — remote playback is the bandwidth that
        // leaves the house.
        const remote = sessions.filter((s) => s.local === false).length;
        const relayed = sessions.filter((s) => s.relayed).length;
        value = sessionsQuery.isLoading ? <SkeletonLine width="40px" /> : remote;
        // Relayed is the subset that goes through Plex's relay rather than a
        // direct connection — capped at 2 Mbps, so it explains a bad stream.
        if (relayed > 0) sub = `${relayed} relayed`;
        else if (sessions.length > 0) sub = `of ${sessions.length}`;
        break;
      }
      case "bandwidth": {
        // In use over capacity. The denominator is the measured *upload*
        // figure: serving a remote stream is this server uploading, so an
        // asymmetric connection would look permanently idle against its
        // download speed.
        const measured = bandwidthQuery.data;
        const capacity = measured?.upMbps ?? 0;
        const inUse = totalBandwidth > 0 ? formatBandwidth(totalBandwidth) : EMPTY;
        // A day of hourly peaks behind the live figure. The value alone can't
        // distinguish a quiet moment on a busy server from a server nobody
        // uses, and that is the difference that decides whether 24 Mbps means
        // anything.
        trend = bandwidthUsageQuery.data;
        if (sessionsQuery.isLoading) {
          value = <SkeletonLine width="40px" />;
        } else if (measured && capacity > 0) {
          // The denominator lives on the sub line — "24.0 Mbps" / "of 860 Mbps"
          // — so the value line stays one number at one size, like every other
          // tile, and the comparison reads as a sentence down the tile.
          value = inUse;
          // Past a month the denominator is a claim about the past, so say when
          // it was made rather than presenting it as current.
          sub =
            measured.staleDays > 30
              ? `of ${formatMbps(capacity)} measured ${formatRelativeShort(measured.startedAt)}`
              : `of ${formatMbps(capacity)}`;
        } else {
          value = inUse;
          sub = "Test bandwidth";
          to = "/settings/bandwidth";
        }
        break;
      }
      case "playsToday":
        value = activityQuery.isLoading ? <SkeletonLine width="40px" /> : (activityQuery.data?.playsToday ?? 0);
        if (activityQuery.data && activityQuery.data.playsWeek > 0) sub = `${activityQuery.data.playsWeek} this week`;
        trend = series;
        break;
      case "playsWeek": {
        const plays = activityQuery.data?.playsWeek ?? 0;
        value = activityQuery.isLoading ? <SkeletonLine width="40px" /> : plays;
        // The label already says "(7d)", so the sub says the thing seven days
        // of total doesn't: the rate.
        if (plays > 0) sub = `~${Math.round(plays / 7)} a day`;
        trend = series;
        break;
      }
      case "topUserToday": {
        const u = activityQuery.data?.topUserToday;
        value = u ? u.name : EMPTY;
        tone = "small";
        sub = u ? `${u.plays} ${u.plays === 1 ? "play" : "plays"}` : null;
        if (u) to = "/users";
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
        to = "/media";
        break;
      case "storage": {
        const sections = storageQuery.data ?? [];
        const bytes = sections.reduce((sum, s) => sum + s.bytes, 0);
        const unsized = sections.reduce((sum, s) => sum + s.unsized, 0);
        const measured = sections.filter((s) => s.bytes > 0);
        value = storageQuery.isLoading ? <SkeletonLine width="60px" /> : bytes > 0 ? formatFileSize(bytes) : EMPTY;
        if (bytes === 0) {
          // Nothing measured yet reads as "nothing stored", which is never
          // true. Say where the number comes from instead.
          sub = storageQuery.isLoading ? null : "Read during Sync Media";
        } else if (unsized > 0) {
          // The caveat outranks the breakdown: a total that leaves items out is
          // the first thing to say about it, and the panel says the rest.
          sub = `${formatNumber(unsized)} not measured`;
        } else {
          sub = `across ${measured.length} librar${measured.length === 1 ? "y" : "ies"}`;
        }
        if (bytes > 0) to = "/media?sort=size&dir=desc";
        break;
      }
      case "shows": {
        const shows = overviewQuery.data?.showCount ?? 0;
        const episodes = overviewQuery.data?.episodeCount ?? 0;
        value = overviewQuery.isLoading ? <SkeletonLine width="40px" /> : formatNumber(shows);
        // Shows alone can't tell a library of long-running series from a shelf
        // of miniseries, and the ratio is the thing you'd work out by hand.
        if (shows > 0) sub = `~${Math.round(episodes / shows)} episodes each`;
        if (shows > 0) to = "/media?type=show";
        break;
      }
      case "addedThisWeek": {
        const added = overviewQuery.data?.addedThisWeek ?? 0;
        value = overviewQuery.isLoading ? <SkeletonLine width="40px" /> : added;
        if (added > 0) {
          sub = "Newest first";
          to = "/media?sort=added&dir=desc";
        }
        break;
      }
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
        if (c4k > 0) {
          sub = `${formatNumber(c4k)} items`;
          to = "/media?res=4k";
        }
        break;
      }
      case "librarySplit": {
        const m = overviewQuery.data?.movieCount ?? 0;
        const e = overviewQuery.data?.episodeCount ?? 0;
        value = overviewQuery.isLoading ? <SkeletonLine width="40px" /> : `${formatNumber(m)} / ${formatNumber(e)}`;
        // The sub used to repeat the tile's own label back at it. The split
        // itself is the thing two counts side by side don't quite say.
        if (m + e > 0) sub = `${Math.round((m / (m + e)) * 100)}% movies`;
        to = "/media";
        break;
      }
      case "users":
        value = overviewQuery.isLoading ? <SkeletonLine width="40px" /> : (overviewQuery.data?.userCount ?? 0);
        if (activityQuery.data && activityQuery.data.activeUsersWeek > 0)
          sub = `${activityQuery.data.activeUsersWeek} active`;
        to = "/users";
        break;
      case "activeUsers": {
        const active = activityQuery.data?.activeUsersWeek ?? 0;
        const total = overviewQuery.data?.userCount ?? 0;
        value = activityQuery.isLoading ? <SkeletonLine width="40px" /> : active;
        // "this week" was already in the label. The denominator isn't.
        if (total > 0) sub = `of ${total}`;
        to = "/users";
        break;
      }
      case "failedJobs": {
        const n = opsQuery.data?.failedJobs24h ?? 0;
        const last = opsQuery.data?.lastFailure;
        value = opsQuery.isLoading ? <SkeletonLine width="40px" /> : n;
        if (n > 0) {
          tone = "danger";
          // The count is the alarm; the sub says which job, which is what you
          // needed before deciding whether to click.
          sub = last ? `${last.name}, ${formatRelativeShort(last.startedAt)}` : "needs attention";
          // The failure itself, not the Jobs page. This tile counts *runs that
          // failed in 24h* — a historical event — while `/jobs?status=failed`
          // lists jobs whose last run is failed *now*. A job that failed three
          // hours ago and has since succeeded is in the first and not the
          // second, so linking there sent you to an empty list with the tile
          // still insisting something was wrong. One failure goes straight to
          // its run log; several go to the list of them.
          to = n === 1 && last ? `/jobs/runs/${last.runId}` : "/events?type=job.failed";
        }
        break;
      }
      case "lastSync":
        value = opsQuery.data?.lastSyncAt ? formatRelativeShort(opsQuery.data.lastSyncAt) : EMPTY;
        tone = "small";
        sub = "Sync jobs";
        to = "/jobs";
        break;
      case "uptime":
        value = opsQuery.data?.uptimeSec != null ? formatUptime(opsQuery.data.uptimeSec) : EMPTY;
        tone = "small";
        break;
    }
    return <SummaryTile key={id} label={def.label} value={value} sub={sub} tone={tone} trend={trend} to={to} />;
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
          {/* Only ever appears once the top-of-app banner has been dismissed —
              see SetupCard. */}
          <SetupCard />

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
