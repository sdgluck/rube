import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";

/**
 * Switch a job on or off, immediately. Optimistic, because a toggle that waits
 * a round trip to move feels broken — and rolled back with a toast on failure,
 * because the old version swallowed errors and left the switch lying.
 */
export function useSetEnabled() {
  const utils = trpc.useUtils();
  const { addToast } = useToast();
  const mutation = trpc.jobs.update.useMutation({
    onMutate: async ({ jobId, enabled }) => {
      await utils.jobs.list.cancel();
      const previous = utils.jobs.list.getData();
      utils.jobs.list.setData(undefined, (rows) =>
        rows?.map((r) => (r.id === jobId ? { ...r, enabled: enabled ? 1 : 0 } : r)),
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) utils.jobs.list.setData(undefined, ctx.previous);
      addToast(err.message, "error");
    },
    onSettled: () => utils.jobs.list.invalidate(),
  });
  return {
    setEnabled: (jobId: string, enabled: boolean) => mutation.mutate({ jobId, enabled }),
    pending: mutation.isPending,
  };
}
