import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import ConfirmModal from "#components/ConfirmModal";
import RelativeTime from "#components/RelativeTime";
import { useToast } from "#components/Toast";

type PendingAction = "enable" | "disable" | null;

const STATUS_LABELS: Record<string, string> = {
  disabled: "Disabled",
  enabling: "Enabling…",
  enabled: "Enabled",
  disabling: "Disabling…",
};

export default function SettingsPersonalization() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const utils = trpc.useUtils();

  const statusQuery = trpc.personalization.status.useQuery(undefined, {
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "enabling" || s === "disabling" ? 3000 : false;
    },
  });

  const enableMutation = trpc.personalization.enable.useMutation();
  const disableMutation = trpc.personalization.disable.useMutation();
  const reconcileMutation = trpc.personalization.reconcile.useMutation();

  const [pending, setPending] = useState<PendingAction>(null);

  const status = statusQuery.data?.status ?? "disabled";
  const enabledAt = statusQuery.data && "enabledAt" in statusQuery.data ? statusQuery.data.enabledAt : undefined;
  const lastReconcileAt =
    statusQuery.data && "lastReconcileAt" in statusQuery.data ? statusQuery.data.lastReconcileAt : undefined;
  const inProgress = status === "enabling" || status === "disabling";

  function onJobStarted(runId: string, label: string) {
    addToast(`${label} started`, "success");
    utils.personalization.status.invalidate();
    navigate(`/jobs/runs/${runId}`);
  }

  function runEnable() {
    setPending(null);
    enableMutation.mutate(undefined, {
      onSuccess: ({ runId }) => onJobStarted(runId, "Enable Personalized Home Screens"),
      onError: (err) => addToast(err.message, "error"),
    });
  }

  function runDisable() {
    setPending(null);
    disableMutation.mutate(undefined, {
      onSuccess: ({ runId }) => onJobStarted(runId, "Disable Personalized Home Screens"),
      onError: (err) => addToast(err.message, "error"),
    });
  }

  function runReconcile() {
    reconcileMutation.mutate(undefined, {
      onSuccess: ({ runId }) => onJobStarted(runId, "Reconcile users"),
      onError: (err) => addToast(err.message, "error"),
    });
  }

  return (
    <div>
      <h3>Personalized Home Screens</h3>
      <p>
        Lets each Plex user get their own home-screen collections (Because You Watched and, later, the self-service
        portal). To make per-user collections visible only to their owner, enabling this labels every item in your
        configured libraries with <code>Tinkerbell</code> and restricts every shared user to their own content plus that
        shared baseline.
      </p>

      <div
        style={{
          border: "1px solid var(--border-color)",
          borderRadius: 6,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          marginTop: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <strong>
              Status: {STATUS_LABELS[status] ?? status}
              {status === "enabled" && enabledAt && (
                <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>
                  {" "}
                  — since <RelativeTime timestamp={enabledAt} />
                </span>
              )}
            </strong>
            {status === "enabled" && lastReconcileAt && (
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                Last reconciled <RelativeTime timestamp={lastReconcileAt} />
              </span>
            )}
            {inProgress && (
              <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                A job is running — this can take a while on large libraries.
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {status === "enabled" && (
              <button type="button" onClick={runReconcile} disabled={reconcileMutation.isPending}>
                Reconcile users
              </button>
            )}
            {status === "disabled" || status === "enabling" ? (
              <button type="button" onClick={() => setPending("enable")} disabled={enableMutation.isPending}>
                {status === "enabling" ? "Resume enabling" : "Enable"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setPending("disable")}
                disabled={disableMutation.isPending}
                style={{ borderColor: "var(--danger, #c0392b)" }}
              >
                {status === "disabling" ? "Resume disabling" : "Disable"}
              </button>
            )}
          </div>
        </div>

        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: 0 }}>
          Note: the Plex server owner can't be restricted, so the owner will see every user's personalized collections.
          Newly shared users aren't restricted automatically — use <em>Reconcile users</em> after adding someone.
        </p>
      </div>

      {pending === "enable" && (
        <ConfirmModal
          message="This labels every item in your configured Plex libraries and restricts each shared user's view to their own content plus the shared baseline. Continue?"
          confirmLabel="Enable"
          onConfirm={runEnable}
          onCancel={() => setPending(null)}
        />
      )}
      {pending === "disable" && (
        <ConfirmModal
          message="This deletes all per-user collections (Because You Watched, etc.) and restores every user's previous sharing settings — leaving your server as if personalization was never enabled. Continue?"
          confirmLabel="Disable"
          onConfirm={runDisable}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
