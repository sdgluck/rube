import { useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import Banner from "#components/Banner";
import { useToast } from "#components/Toast";
import controls from "#/styles/controls.module.css";

/**
 * Top-of-Rules-page nudge surfacing per-provider migration counts.
 * Pulls aggregate status from the migration domain — one rendered
 * sentence covers any combination of providers (Kometa, Plex Smart,
 * MDBList, …) that have unmigrated, undismissed items.
 */
export default function MigrationBanner() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { addToast } = useToast();
  const status = trpc.migration.status.useQuery(undefined, { refetchOnWindowFocus: false });
  const dismiss = trpc.migration.dismiss.useMutation();

  if (!status.data?.shouldShowBanner) return null;
  const actionable = status.data.providers.filter((p) => p.shouldShowBanner);
  const count = actionable.reduce((sum, p) => sum + p.count, 0);
  const labels = actionable.map((p) => p.label);
  const labelText =
    labels.length === 1
      ? labels[0]
      : labels.length === 2
        ? `${labels[0]} and ${labels[1]}`
        : `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;

  const handleDismiss = async () => {
    try {
      await Promise.all(actionable.map((p) => dismiss.mutateAsync({ providerId: p.id })));
      await utils.migration.status.invalidate();
    } catch (err) {
      addToast(`Failed to dismiss banner: ${(err as Error).message ?? err}`, "error");
    }
  };

  return (
    <Banner
      variant="info"
      actions={
        <>
          <button
            type="button"
            className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`}
            onClick={() => navigate("/settings/migrate")}
          >
            Review
          </button>
          <button
            type="button"
            className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}
            onClick={handleDismiss}
            disabled={dismiss.isPending}
          >
            Dismiss
          </button>
        </>
      }
    >
      Tinkerbell can migrate <strong>{count}</strong> {labelText}-managed collection{count === 1 ? "" : "s"} into
      Tinkerbell rules.
    </Banner>
  );
}
