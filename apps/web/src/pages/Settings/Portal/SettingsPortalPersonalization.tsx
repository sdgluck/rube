import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import { formatDuration } from "#/format";
import ConfirmModal from "#components/ConfirmModal";
import RelativeTime from "#components/RelativeTime";
import { useToast } from "#components/Toast";
import styles from "../Personalization.module.css";

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
  const estimateQuery = trpc.personalization.estimate.useQuery(undefined, { enabled: pending === "enable" });

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
      <p className={styles.hint}>
        When enabled, every item in your configured libraries is labelled <code>Tinkerbell</code> and every shared user
        is restricted to their own content plus that shared baseline — which is what makes per-user collections (Because
        You Watched, the self-service portal) visible only to their owner.
      </p>
      <div className={styles.card}>
        <div className={styles.row}>
          <div>
            <div className={styles.statusLine}>
              Status: {STATUS_LABELS[status] ?? status}
              {status === "enabled" && enabledAt && (
                <span className={styles.muted}>
                  {" — since "}
                  <RelativeTime timestamp={enabledAt} />
                </span>
              )}
            </div>
            {status === "enabled" && lastReconcileAt && (
              <div className={styles.hint}>
                Last reconciled <RelativeTime timestamp={lastReconcileAt} />
              </div>
            )}
            {inProgress && (
              <div className={styles.hint}>A job is running — this can take a while on large libraries.</div>
            )}
          </div>

          <div className={styles.actions}>
            {status === "enabled" && (
              <button
                type="button"
                className={styles.secondary}
                onClick={runReconcile}
                disabled={reconcileMutation.isPending}
              >
                Reconcile users
              </button>
            )}
            {status === "disabled" || status === "enabling" ? (
              <button
                type="button"
                className={styles.primary}
                onClick={() => setPending("enable")}
                disabled={enableMutation.isPending}
              >
                {status === "enabling" ? "Resume enabling" : "Enable"}
              </button>
            ) : (
              <button
                type="button"
                className={styles.danger}
                onClick={() => setPending("disable")}
                disabled={disableMutation.isPending}
              >
                {status === "disabling" ? "Resume disabling" : "Disable"}
              </button>
            )}
          </div>
        </div>

        <p className={styles.hint}>
          Note: the Plex server owner can't be restricted, so the owner will see every user's personalized collections.
          Newly shared users are restricted automatically when the Sync Plex Users job runs.
        </p>
      </div>

      {pending === "enable" && (
        <ConfirmModal
          message={(() => {
            const base =
              "This labels every item in your configured Plex libraries and restricts each shared user's view to their own content plus the shared baseline.";
            if (estimateQuery.isLoading) return `${base} Estimating duration… Continue?`;
            const est = estimateQuery.data;
            if (!est) return `${base} Continue?`;
            const items = est.itemCount.toLocaleString();
            return `${base} About ${items} items to label — estimated ~${formatDuration(est.estimatedSeconds * 1000)}. Continue?`;
          })()}
          title="Enable personalization?"
          confirmLabel="Enable"
          onConfirm={runEnable}
          onCancel={() => setPending(null)}
        />
      )}
      {pending === "disable" && (
        <ConfirmModal
          message="This deletes all per-user collections (Because You Watched, etc.) and restores every user's previous sharing settings — leaving your server as if personalization was never enabled. Continue?"
          title="Disable personalization?"
          confirmLabel="Disable"
          danger
          onConfirm={runDisable}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
