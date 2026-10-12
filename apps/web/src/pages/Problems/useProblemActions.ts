import { useState } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";

/** The problem list, dismissed ones included and marked, plus when episodes were last compared. */
export function useProblems() {
  const query = trpc.problems.list.useQuery();
  return { query, problems: query.data?.problems ?? [], lastScannedAt: query.data?.lastScannedAt ?? null };
}

export type ProblemRow = ReturnType<typeof useProblems>["problems"][number];

/**
 * Every Problems mutation, shared by the overview and the per-kind page.
 *
 * `busy` names the one fix in flight. Fixes are serialised on purpose —
 * each is a Plex write and a refresh — so while one runs, every other Fix
 * button is disabled rather than queued behind it.
 */
export function useProblemActions() {
  const utils = trpc.useUtils();
  const { addToast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => {
    void utils.problems.list.invalidate();
    void utils.nav.metrics.invalidate();
  };
  const onError = (err: { message: string }) => addToast(err.message, "error");
  const settle = () => {
    setBusy(null);
    refresh();
  };

  const fix = trpc.problems.fix.useMutation({
    onSuccess: (r) => addToast(r.message, "success"),
    onError,
    onSettled: settle,
  });
  const fixAll = trpc.problems.fixAll.useMutation({
    onSuccess: (r) => {
      addToast(`Fixed ${r.fixed}.`, "success");
      for (const f of r.failed) addToast(`${f.title}: ${f.error}`, "error");
    },
    onError,
    onSettled: settle,
  });
  const dismiss = trpc.problems.dismiss.useMutation({ onError, onSettled: refresh });
  const undismiss = trpc.problems.undismiss.useMutation({ onError, onSettled: refresh });
  const dismissMany = trpc.problems.dismissMany.useMutation({
    onSuccess: (r) => addToast(`Dismissed ${r.dismissed}.`, "success"),
    onError,
    onSettled: refresh,
  });
  const undismissMany = trpc.problems.undismissMany.useMutation({
    onSuccess: (r) => addToast(`Restored ${r.restored}.`, "success"),
    onError,
    onSettled: refresh,
  });
  const rescan = trpc.problems.rescan.useMutation({
    onSuccess: (r) =>
      addToast(r.ok ? "Scanning — results appear here as it finishes." : "A scan is already running.", "info"),
    onError,
  });

  return { busy, setBusy, fix, fixAll, dismiss, undismiss, dismissMany, undismissMany, rescan };
}
