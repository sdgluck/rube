import { trpc } from "#/trpc";
import Banner from "#components/Banner";
import RelativeTime from "#components/RelativeTime";
import { useToast } from "#components/Toast";
import styles from "#pages/Jobs/Jobs.module.css";

/**
 * "This job will pick up where it left off."
 *
 * `generate` (per rule) and `sync-media` (per section) checkpoint their
 * progress so a container restart doesn't redo hours of work. That has always
 * worked, and always worked silently — which means the one moment it matters,
 * a failed run whose successor will resume rather than start over, looked
 * exactly like one that will start over. Somebody pressing Run Now after a
 * crash had no way to know which of the two they were about to get.
 *
 * Both answers are offered, because both are sometimes right: resuming is what
 * you want after a restart, and starting fresh is what you want when the
 * library changed underneath the abandoned run.
 */
export default function CheckpointNotice({ jobId }: { jobId: string }) {
  const utils = trpc.useUtils();
  const { addToast } = useToast();
  const query = trpc.jobs.checkpoint.useQuery({ jobId }, { refetchOnWindowFocus: false });
  const discard = trpc.jobs.discardCheckpoint.useMutation({
    onSuccess: () => {
      utils.jobs.checkpoint.invalidate({ jobId });
      addToast("Checkpoint discarded — the next run starts from scratch.", "success");
    },
    onError: (err) => addToast(err.message, "error"),
  });

  const checkpoint = query.data;
  if (!checkpoint) return null;

  return (
    <Banner
      variant={checkpoint.expired ? "warn" : "info"}
      actions={
        <button
          type="button"
          className={styles.button}
          onClick={() => discard.mutate({ jobId })}
          disabled={discard.isPending}
        >
          {discard.isPending ? "Discarding…" : "Start fresh instead"}
        </button>
      }
    >
      {checkpoint.expired ? (
        <>
          This job left a checkpoint <RelativeTime timestamp={checkpoint.updatedAt} />, but it has expired — the next
          run will discard it and start from the beginning.
        </>
      ) : (
        <>
          A previous run stopped part-way <RelativeTime timestamp={checkpoint.updatedAt} /> and saved its progress. The
          next run resumes from there rather than starting over. The checkpoint expires{" "}
          <RelativeTime timestamp={checkpoint.expiresAt} />.
        </>
      )}
    </Banner>
  );
}
