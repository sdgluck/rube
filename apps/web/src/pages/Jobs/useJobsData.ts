import { trpc } from "#/trpc";
import { useListParams } from "#hooks/useListParams";
import { getJobFields } from "./fields";
import { isRunActive } from "./shared/useRunLog";

export const JOB_SORT_KEYS = ["name", "schedule", "enabled", "lastRun", "lastRunStatus"] as const;
export type JobSortKey = (typeof JOB_SORT_KEYS)[number];

/**
 * `?status=` on the Jobs page — the filters worth arriving on from somewhere
 * else. "failed" is what the Stats tile links to; the other two are the same
 * question asked about the other two states a job can be in.
 */
interface JobRunState {
  lastRunStatus?: string | null;
  lastRunStartedAt?: number | null;
}

export const JOB_STATUS_FILTERS = {
  failed: { label: "whose last run failed", match: (j: JobRunState) => j.lastRunStatus === "failed" },
  running: { label: "running now", match: (j: JobRunState) => isRunActive(j.lastRunStatus ?? undefined) },
  never: { label: "that have never run", match: (j: JobRunState) => j.lastRunStartedAt == null },
} as const;
export type JobStatusFilter = keyof typeof JOB_STATUS_FILTERS;
export const JOB_STATUS_KEYS = Object.keys(JOB_STATUS_FILTERS) as JobStatusFilter[];

/**
 * The Jobs dashboard's shared reads. Every panel calls this instead of being
 * handed props: react-query dedupes the two queries by key, so the panels stay
 * independently draggable without the page having to thread state through them.
 */
export function useJobsData() {
  const jobsQuery = trpc.jobs.list.useQuery(undefined, { refetchInterval: 5000 });
  const recentRunsQuery = trpc.jobs.recentRuns.useQuery(undefined, { refetchInterval: 3000 });

  const { sortKey, sortDir, toggleSort, param, setParam } = useListParams<JobSortKey>({
    sortKeys: JOB_SORT_KEYS,
    defaultSortKey: "name",
    descFirst: ["lastRun"],
  });

  const statusParam = param("status");
  const statusFilter = (JOB_STATUS_KEYS as string[]).includes(statusParam) ? (statusParam as JobStatusFilter) : null;

  const rawJobs = (jobsQuery.data ?? []).filter((j) => getJobFields(j.id).kind !== "hidden");
  const sortedJobs = [...rawJobs].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "schedule":
        cmp = (a.schedule || "").localeCompare(b.schedule || "");
        break;
      case "enabled":
        cmp = (a.enabled ? 1 : 0) - (b.enabled ? 1 : 0);
        break;
      case "lastRun":
        cmp = (a.lastRunStartedAt ?? 0) - (b.lastRunStartedAt ?? 0);
        break;
      case "lastRunStatus":
        cmp = (a.lastRunStatus ?? "").localeCompare(b.lastRunStatus ?? "");
        break;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  // Filtered here rather than in each panel so that the two job tables agree
  // about what "showing failed" means — and `rawJobs` stays whole, because the
  // summary tiles count the fleet, not the current view of it.
  const visibleJobs = statusFilter ? sortedJobs.filter(JOB_STATUS_FILTERS[statusFilter].match) : sortedJobs;

  return {
    jobsQuery,
    recentRunsQuery,
    rawJobs,
    sortedJobs,
    // System Tasks vs Features split — kind comes from fields.ts.
    systemJobs: visibleJobs.filter((j) => getJobFields(j.id).kind === "system"),
    featureJobs: visibleJobs.filter((j) => getJobFields(j.id).kind === "feature"),
    statusFilter,
    setStatusFilter: (next: JobStatusFilter | null) => setParam("status", next ?? ""),
    sortKey,
    sortDir,
    toggleSort,
  };
}
