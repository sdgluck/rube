import { useEffect } from "react";
import { trpc } from "#/trpc";
import type { Job } from "#pages/Jobs/types";

export function useJobActions(job: Job) {
  const utils = trpc.useUtils();

  const runsQuery = trpc.jobs.runs.useQuery({ jobId: job.id, limit: 10 }, { refetchInterval: 3000 });
  const latestRunId = runsQuery.data?.[0]?.id;

  const latestRunQuery = trpc.jobs.run.useQuery(
    { runId: latestRunId! },
    {
      enabled: !!latestRunId,
      refetchInterval: (query) => (query.state.data?.status === "running" ? 1000 : false),
    },
  );

  const startMutation = trpc.jobs.start.useMutation({
    onSuccess: () => {
      utils.jobs.list.invalidate();
      utils.jobs.runs.invalidate();
    },
  });

  const cancelMutation = trpc.jobs.cancel.useMutation({
    onSuccess: () => {
      utils.jobs.runs.invalidate();
      latestRunQuery.refetch();
    },
  });

  const isRunning = job.lastRunStatus === "running";

  useEffect(() => {
    if (isRunning) {
      const interval = setInterval(() => utils.jobs.list.invalidate(), 3000);
      return () => clearInterval(interval);
    }
  }, [isRunning, utils]);

  return {
    runsQuery,
    latestRun: latestRunQuery.data,
    isRunning,
    start: () => startMutation.mutate({ jobId: job.id }),
    starting: startMutation.isPending,
    cancel: (runId: string) => cancelMutation.mutate({ runId }),
    cancelling: cancelMutation.isPending,
  };
}
