import { useEffect } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import type { Job } from "#pages/Jobs/types";
import { isRunActive } from "./useRunLog";

export function useJobActions(job: Job) {
  const utils = trpc.useUtils();
  const { addToast } = useToast();

  const runsQuery = trpc.jobs.runs.useQuery({ jobId: job.id, limit: 10 }, { refetchInterval: 3000 });
  const latestRunId = runsQuery.data?.[0]?.id;

  const latestRunQuery = trpc.jobs.run.useQuery(
    { runId: latestRunId! },
    {
      enabled: !!latestRunId,
      refetchInterval: (query) => (isRunActive(query.state.data?.status) ? 1000 : false),
    },
  );

  const startMutation = trpc.jobs.start.useMutation({
    onSuccess: () => {
      utils.jobs.list.invalidate();
      utils.jobs.runs.invalidate();
    },
    // "Already running" and friends used to vanish silently, leaving a button
    // that apparently did nothing.
    onError: (err) => addToast(err.message, "error"),
  });

  const cancelMutation = trpc.jobs.cancel.useMutation({
    onSuccess: () => {
      utils.jobs.runs.invalidate();
      latestRunQuery.refetch();
    },
  });

  // A `cancelling` run still occupies the job — the command hasn't unwound and
  // `startJob` will refuse a second one — so it counts as running here.
  const isRunning = isRunActive(job.lastRunStatus ?? undefined);

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
    start: (variant?: string) => startMutation.mutate({ jobId: job.id, variant }),
    starting: startMutation.isPending,
    cancel: (runId: string) => cancelMutation.mutate({ runId }),
    cancelling: cancelMutation.isPending,
  };
}
