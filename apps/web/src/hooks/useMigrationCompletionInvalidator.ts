import { useEffect, useRef } from "react";
import { trpc } from "#/trpc";

export default function useMigrationCompletionInvalidator() {
  const utils = trpc.useUtils();
  const activeRunsQuery = trpc.jobs.activeRuns.useQuery(undefined, { refetchInterval: 2000 });
  const runs = activeRunsQuery.data;
  const prevMigrateRunIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!runs) return;
    const currentMigrateIds = new Set(runs.filter((r) => r.jobId === "migrate-collections").map((r) => r.id));
    let completedAny = false;
    for (const id of prevMigrateRunIds.current) {
      if (!currentMigrateIds.has(id)) completedAny = true;
    }
    if (completedAny) {
      utils.rules.list.invalidate();
      utils.migration.status.invalidate();
    }
    prevMigrateRunIds.current = currentMigrateIds;
  }, [runs, utils]);
}
