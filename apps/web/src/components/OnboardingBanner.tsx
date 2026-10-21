import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import styles from "./OnboardingBanner.module.css";

/**
 * Progress strip for an unfinished setup.
 *
 * Sits beside AuthBanner as server-wide chrome and follows the same principle:
 * a nudge, never a wall. Two things make it stop appearing — finishing setup,
 * which needs no action at all, and dismissing it, which is permanent and
 * server-side so it holds on every browser the admin uses.
 *
 * Dismissing hides the banner, not the flow: `/onboarding` stays in the sidebar
 * for as long as setup is unfinished (and under Settings › Setup for good), and
 * Stats grows a card in its place.
 */
export default function OnboardingBanner() {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const statusQuery = trpc.onboarding.status.useQuery(undefined, { retry: false });
  const dismiss = trpc.onboarding.dismiss.useMutation();

  const status = statusQuery.data;
  if (!status?.shouldShowBanner) return null;

  const { completedCount, totalCount } = status;
  const pct = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

  async function handleDismiss() {
    try {
      await dismiss.mutateAsync();
      await utils.onboarding.status.invalidate();
    } catch (err) {
      addToast(`Couldn't dismiss: ${(err as Error).message}`, "error");
    }
  }

  return (
    <div className={`app-notice ${styles.banner}`} role="status">
      <span className={styles.text}>
        <strong>Finish setting up Rube</strong>
      </span>
      <span className={styles.progress}>
        <span
          className={styles.track}
          role="progressbar"
          aria-valuenow={completedCount}
          aria-valuemin={0}
          aria-valuemax={totalCount}
          aria-label="Setup progress"
        >
          <span className={styles.fill} style={{ inlineSize: `${pct}%` }} />
        </span>
        <span className={styles.count}>
          {completedCount} of {totalCount}
        </span>
      </span>
      <span className={styles.actions}>
        <Link to="/onboarding" className={styles.link}>
          {status.missingRequired.includes("connect") ? "Connect Plex" : "Resume"}
        </Link>
        <button type="button" className={styles.dismiss} onClick={handleDismiss} disabled={dismiss.isPending}>
          Dismiss
        </button>
      </span>
    </div>
  );
}
