import { variantFor } from "@rube/contracts";
import styles from "#pages/Jobs/Jobs.module.css";

/**
 * A run's status, and the variant it ran as when it wasn't an ordinary run.
 *
 * `cancelling` is a real, visible state: the cancel has been requested but the
 * command hasn't unwound yet, and pretending it's already gone would be a lie
 * the user can see through (the job is still occupied). This used to be
 * handled by a second copy of this component on the run page only.
 */
export default function StatusBadge({
  status,
  variant,
  command,
}: {
  status?: string;
  variant?: string | null;
  command?: string;
}) {
  if (!status) return null;
  const cls =
    status === "running" || status === "cancelling"
      ? styles.badgeRunning
      : status === "completed"
        ? styles.badgeCompleted
        : status === "failed"
          ? styles.badgeFailed
          : styles.badgeCancelled;
  const variantLabel = variant ? ((command && variantFor(command, variant)?.label) ?? variant) : null;
  return (
    <>
      <span className={`${styles.badge} ${cls}`}>{status === "cancelling" ? "cancelling…" : status}</span>
      {variantLabel && <span className={`${styles.badge} ${styles.badgeVariant}`}>{variantLabel}</span>}
    </>
  );
}
