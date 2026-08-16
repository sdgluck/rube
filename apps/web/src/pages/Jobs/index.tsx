import type React from "react";
import { useEffect } from "react";
import { trpc } from "#/trpc";
import RelativeTime from "#components/RelativeTime";
import { JobsSkeleton } from "#components/Skeleton";
import PullToRefresh from "#components/PullToRefresh";
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
import { EMPTY, formatDuration, formatTimeUntil } from "#/format";
import Banner from "#components/Banner";
import { isRunActive } from "./shared/useRunLog";
import { JOB_STATUS_FILTERS, useJobsData } from "./useJobsData";
import styles from "./Jobs.module.css";
import { FeaturesPanel } from "./panels/FeaturesPanel";
import { RecentLogsPanel } from "./panels/RecentLogsPanel";
import { RecentRunsPanel } from "./panels/RecentRunsPanel";
import { SystemTasksPanel } from "./panels/SystemTasksPanel";
import { UpcomingPanel, useUpcomingRuns } from "./panels/UpcomingPanel";

// ─── Panels ─────────────────────────────────────────────────────────────────

const PANEL_IDS = ["recentRuns", "upcoming", "systemTasks", "features", "recentLogs"] as const;
type PanelId = (typeof PANEL_IDS)[number];

const PANEL_COMPONENTS: Record<PanelId, React.ComponentType<DashboardPanelProps>> = {
  recentRuns: RecentRunsPanel,
  upcoming: UpcomingPanel,
  systemTasks: SystemTasksPanel,
  features: FeaturesPanel,
  recentLogs: RecentLogsPanel,
};

// ─── Summary tile config ────────────────────────────────────────────────────

const DEFAULT_TILES = ["total", "enabled", "running", "lastFailure"];
const MAX_TILES = 6;

const TILE_REGISTRY: TileDef[] = [
  { id: "total", label: "Total", group: "Overview" },
  { id: "features", label: "Features", group: "Overview" },
  { id: "system", label: "System Tasks", group: "Overview" },
  { id: "enabled", label: "Enabled", group: "Overview" },
  { id: "disabled", label: "Paused", group: "Overview" },
  { id: "scheduled", label: "Scheduled", group: "Overview" },
  { id: "running", label: "Running", group: "Activity" },
  { id: "lastRun", label: "Last Run", group: "Activity" },
  { id: "nextRun", label: "Next Run", group: "Activity" },
  { id: "lastDuration", label: "Last Duration", group: "Activity" },
  { id: "failing", label: "Failing", group: "Health" },
  { id: "lastFailure", label: "Last Failure", group: "Health" },
  { id: "neverRun", label: "Never Run", group: "Health" },
];

// ─── Main component ─────────────────────────────────────────────────────────

export default function Jobs() {
  const utils = trpc.useUtils();
  const { jobsQuery, recentRunsQuery, rawJobs, systemJobs, featureJobs, statusFilter, setStatusFilter } = useJobsData();
  const upcoming = useUpcomingRuns(1);

  const lastFailureQuery = trpc.jobs.lastFailure.useQuery(undefined, { refetchInterval: 15000 });
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const saveConfigMutation = trpc.config.save.useMutation({
    onSuccess: () => utils.config.get.invalidate(),
  });

  const runningCount = recentRunsQuery.data?.filter((r) => isRunActive(r.status)).length ?? 0;

  // A running job's row is stale the moment it finishes, and the 5s list poll
  // is too slow to feel live while something is in flight.
  useEffect(() => {
    if (runningCount === 0) return;
    const interval = setInterval(() => utils.jobs.list.invalidate(), 3000);
    return () => clearInterval(interval);
  }, [runningCount, utils]);

  const selectedTiles = resolveTiles(configQuery.data?.jobs_summary_tiles, TILE_REGISTRY, DEFAULT_TILES, MAX_TILES);

  const { order, dragHandleFor, dragPropsFor } = usePanelOrder<PanelId>({
    ids: PANEL_IDS,
    saved: configQuery.data?.jobs_panel_order,
    onSave: (next) => saveConfigMutation.mutate({ jobs_panel_order: next }),
  });

  const renderTile = (id: string): React.ReactNode => {
    const def = TILE_REGISTRY.find((t) => t.id === id);
    if (!def) return null;

    let value: React.ReactNode = EMPTY;
    let sub: React.ReactNode = null;
    let tone: "small" | "accent" | "danger" | undefined;
    // The health tiles filter the page they are already on, which is the whole
    // of what "3 failing" wants you to do next.
    let to: string | undefined;

    switch (id) {
      case "total":
        value = rawJobs.length;
        break;
      case "features":
        value = featureJobs.length;
        sub = featureJobs.length > 0 ? `${featureJobs.filter((j) => j.enabled).length} on` : null;
        break;
      case "system":
        value = systemJobs.length;
        break;
      case "enabled":
        value = rawJobs.filter((j) => j.enabled).length;
        break;
      case "disabled":
        value = rawJobs.filter((j) => !j.enabled).length;
        break;
      case "scheduled":
        value = rawJobs.filter((j) => j.enabled && j.schedule).length;
        break;
      case "running":
        value = runningCount;
        if (runningCount > 0) {
          tone = "accent";
          to = "/jobs?status=running";
        }
        break;
      case "lastRun": {
        const last = rawJobs
          .filter((j) => j.lastRunStartedAt)
          .sort((a, b) => (b.lastRunStartedAt ?? 0) - (a.lastRunStartedAt ?? 0))[0];
        value = last?.lastRunStartedAt ? <RelativeTime timestamp={last.lastRunStartedAt} /> : EMPTY;
        sub = last?.name ?? null;
        tone = "small";
        break;
      }
      case "nextRun": {
        const next = upcoming[0];
        value = next ? formatTimeUntil(next.nextRun) : EMPTY;
        sub = next?.name ?? null;
        tone = "small";
        break;
      }
      case "lastDuration": {
        // The most recent run that actually finished — an in-flight run has no
        // duration to report yet.
        const done = (recentRunsQuery.data ?? []).find((r) => !isRunActive(r.status) && r.finishedAt != null);
        value = done?.finishedAt ? formatDuration(done.finishedAt - done.startedAt) : EMPTY;
        sub = done?.jobName ?? null;
        tone = "small";
        break;
      }
      case "failing": {
        const failing = rawJobs.filter((j) => j.lastRunStatus === "failed");
        value = failing.length;
        if (failing.length > 0) {
          tone = "danger";
          // Which job, rather than the words "needs attention" — the tone the
          // number is drawn in already says that much.
          sub = failing.length === 1 ? failing[0].name : `${failing[0].name} +${failing.length - 1} more`;
          to = "/jobs?status=failed";
        }
        break;
      }
      case "lastFailure": {
        // The last run that failed, not "a job whose latest run is failed" —
        // the second forgets a failure the moment the job next succeeds, which
        // is how this tile used to read "—" while the Stats dashboard and the
        // event log both had a failure from that morning. Same server query as
        // the Stats tile, so the three cannot disagree.
        const lastFailure = lastFailureQuery.data;
        value = lastFailure ? <RelativeTime timestamp={lastFailure.startedAt} /> : EMPTY;
        sub = lastFailure?.name ?? null;
        tone = "small";
        if (lastFailure) to = `/jobs/runs/${lastFailure.runId}`;
        break;
      }
      case "neverRun": {
        const n = rawJobs.filter((j) => !j.lastRunStartedAt).length;
        value = n;
        if (n > 0) to = "/jobs?status=never";
        break;
      }
    }

    return <SummaryTile key={id} label={def.label} value={value} sub={sub} tone={tone} to={to} />;
  };

  const handleRefresh = () => {
    jobsQuery.refetch();
    recentRunsQuery.refetch();
  };

  if (jobsQuery.isLoading) return <JobsSkeleton />;
  if (jobsQuery.error) {
    return <ErrorState title="Couldn't load jobs" error={jobsQuery.error} onRetry={() => jobsQuery.refetch()} />;
  }

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <PageShell
        count={rawJobs.length > 0 ? rawJobs.length : undefined}
        chip={
          runningCount > 0 ? (
            <StatusChip tone="running" dot>
              {runningCount} running
            </StatusChip>
          ) : undefined
        }
        actions={
          <TilePicker
            registry={TILE_REGISTRY}
            selected={selectedTiles}
            max={MAX_TILES}
            onSave={(next) => saveConfigMutation.mutate({ jobs_summary_tiles: next.slice(0, MAX_TILES) })}
          />
        }
      >
        <DashboardLayout>
          <SummaryBar>{selectedTiles.map(renderTile)}</SummaryBar>

          {/* Arriving here from the Stats tile lands on a filtered page, and a
              job table that is quietly missing most of its rows reads as a bug.
              Say what is being withheld, and offer the way out. */}
          {statusFilter && (
            <Banner
              variant="info"
              actions={
                <button type="button" className={styles.headerBtn} onClick={() => setStatusFilter(null)}>
                  Show all
                </button>
              }
            >
              Showing {systemJobs.length + featureJobs.length} of {rawJobs.length} jobs{" "}
              {JOB_STATUS_FILTERS[statusFilter].label}.
            </Banner>
          )}

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
