import { useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import { useToast } from "#/Toast";

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
    <div
      style={{
        margin: "0 0 16px 0",
        padding: "12px 16px",
        background: "rgba(74, 108, 247, 0.08)",
        border: "1px solid rgba(74, 108, 247, 0.3)",
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        gap: 12,
        lineHeight: 1.5,
      }}
    >
      <div style={{ flex: 1 }}>
        Tinkerbell can migrate <strong>{count}</strong> {labelText}-managed collection{count === 1 ? "" : "s"} into
        Tinkerbell rules.
      </div>
      <button
        type="button"
        onClick={() => navigate("/settings/migrate")}
        style={{
          padding: "6px 14px",
          background: "var(--accent)",
          color: "#fff",
          border: "1px solid var(--accent)",
          borderRadius: 6,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Review
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        style={{
          padding: "6px 14px",
          background: "transparent",
          color: "var(--color-muted, #888)",
          border: "1px solid var(--border-input)",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
