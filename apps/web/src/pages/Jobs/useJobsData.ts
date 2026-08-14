import { trpc } from "#/trpc";
import { useListParams } from "#hooks/useListParams";
import { getJobFields } from "./fields";

export const JOB_SORT_KEYS = ["name", "schedule", "enabled", "lastRun", "lastRunStatus"] as const;
export type JobSortKey = (typeof JOB_SORT_KEYS)[number];

/**
 * The Jobs dashboard's shared reads. Every panel calls this instead of being
 * handed props: react-query dedupes the two queries by key, so the panels stay
 * independently draggable without the page having to thread state through them.
 */
export function useJobsData() {
  const jobsQuery = trpc.jobs.list.useQuery(undefined, { refetchInterval: 5000 });
  const recentRunsQuery = trpc.jobs.recentRuns.useQuery(undefined, { refetchInterval: 3000 });

  const { sortKey, sortDir, toggleSort } = useListParams<JobSortKey>({
    sortKeys: JOB_SORT_KEYS,
    defaultSortKey: "name",
    descFirst: ["lastRun"],
  });

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

  return {
    jobsQuery,
    recentRunsQuery,
    rawJobs,
    sortedJobs,
    // System Tasks vs Features split — kind comes from fields.ts.
    systemJobs: sortedJobs.filter((j) => getJobFields(j.id).kind === "system"),
    featureJobs: sortedJobs.filter((j) => getJobFields(j.id).kind === "feature"),
    sortKey,
    sortDir,
    toggleSort,
  };
}
