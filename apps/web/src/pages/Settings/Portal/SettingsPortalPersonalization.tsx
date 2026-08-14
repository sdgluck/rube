import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import { formatDuration } from "#/format";
import ConfirmModal from "#components/ConfirmModal";
import RelativeTime from "#components/RelativeTime";
import { useToast } from "#components/Toast";
import ErrorState from "#components/ErrorState";
import styles from "../Personalization.module.css";

type PendingAction = "enable" | "disable" | null;

const STATUS_LABELS: Record<string, string> = {
  disabled: "Off",
  enabling: "Turning on…",
  enabled: "On",
  disabling: "Turning off…",
};

const STATUS_TONES: Record<string, string> = {
  disabled: styles.pillNeutral,
  enabling: styles.pillWarn,
  enabled: styles.pillOk,
  disabling: styles.pillWarn,
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
  // "enabling" means a previous run stopped half-way: the next thing to do is
  // still to finish turning it on, so the on-side card stays the live one.
  const nextAction = status === "enabled" || status === "disabling" ? "disable" : "enable";

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

  if (statusQuery.error && !statusQuery.data) {
    return (
      <ErrorState
        title="Couldn't load personalization status"
        error={statusQuery.error}
        onRetry={() => statusQuery.refetch()}
      />
    );
  }

  return (
    <div className={styles.stack}>
      <p className={styles.lede}>
        Personalization is the master switch that makes per-user collections — Because You Watched, the self-service
        portal — visible only to the user they were built for. Plex has no per-user visibility of its own, so Tinkerbell
        gets it by labelling your whole library and restricting each shared user to their own slice of it.
      </p>

      <div className={styles.card}>
        <div className={styles.row}>
          <div className={styles.statusBlock}>
            <div className={styles.statusLine}>
              <span className={`${styles.pill} ${STATUS_TONES[status] ?? styles.pillNeutral}`}>
                <span className={styles.pillDot} />
                {STATUS_LABELS[status] ?? status}
              </span>
              {status === "enabled" && enabledAt && (
                <span className={styles.muted}>
                  since <RelativeTime timestamp={enabledAt} />
                </span>
              )}
            </div>
            {status === "enabled" && lastReconcileAt && (
              <p className={styles.hint}>
                Users last reconciled <RelativeTime timestamp={lastReconcileAt} />.
              </p>
            )}
            {inProgress && (
              <p className={styles.hint}>
                A job is running — this can take a while on large libraries. It's safe to leave and come back;
                re-running picks up where it left off.
              </p>
            )}
            {status === "disabled" && <p className={styles.hint}>Nothing is labelled and no user is restricted.</p>}
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
            {nextAction === "enable" ? (
              <button
                type="button"
                className={styles.primary}
                onClick={() => setPending("enable")}
                disabled={enableMutation.isPending}
              >
                {status === "enabling" ? "Resume turning on" : "Turn on"}
              </button>
            ) : (
              <button
                type="button"
                className={styles.danger}
                onClick={() => setPending("disable")}
                disabled={disableMutation.isPending}
              >
                {status === "disabling" ? "Resume turning off" : "Turn off"}
              </button>
            )}
          </div>
        </div>

        {status === "enabled" && (
          <p className={styles.hint}>
            Reconcile users re-applies restrictions to anyone shared with since you turned this on — useful if you don't
            want to wait for the next Sync Plex Users run.
          </p>
        )}
      </div>

      <div className={styles.consequences}>
        <section className={`${styles.consequence} ${nextAction === "enable" ? styles.consequenceLive : ""}`}>
          <h3 className={styles.consequenceTitle}>Turning it on</h3>
          <ol className={styles.steps}>
            <li>
              Saves each shared user's current library restrictions, so they can be put back exactly as they were.
            </li>
            <li>
              Adds the <code className={styles.code}>Tinkerbell</code> label to every item in your configured libraries.
              This is what keeps restricted users seeing the whole library.
            </li>
            <li>
              Restricts every shared user to <code className={styles.code}>Tinkerbell</code> plus their own{" "}
              <code className={styles.code}>User:name</code> label — so a personalized collection only shows up for its
              owner.
            </li>
          </ol>
          <p className={styles.consequenceNote}>
            Your users keep access to everything they had before. Nothing is deleted, and their Plex watch history and
            playlists are untouched.
          </p>
        </section>

        <section className={`${styles.consequence} ${nextAction === "disable" ? styles.consequenceLive : ""}`}>
          <h3 className={styles.consequenceTitle}>Turning it off</h3>
          <ol className={styles.steps}>
            <li>
              Deletes every per-user collection — anything carrying a <code className={styles.code}>User:</code> label.
              Collections you share with everyone are left alone.
            </li>
            <li>Restores each user's original sharing restrictions from the saved snapshot.</li>
            <li>
              Removes the <code className={styles.code}>Tinkerbell</code> label from every item.
            </li>
          </ol>
          <p className={styles.consequenceNote}>
            Your server is left as if personalization was never enabled. Turning it back on rebuilds the collections
            from scratch on the next feature run.
          </p>
        </section>
      </div>

      <div className={styles.card}>
        <h3 className={styles.consequenceTitle}>Worth knowing</h3>
        <ul className={styles.caveats}>
          <li>
            Plex won't let the server owner be restricted, so on your own account you'll keep seeing every user's
            personalized collections mixed in with your own.
          </li>
          <li>Users you share with later are restricted automatically the next time the Sync Plex Users job runs.</li>
          <li>
            Both jobs walk every item in your configured libraries, so a large server takes a while. Either one is safe
            to interrupt and re-run — they pick up where they left off.
          </li>
          <li>
            If you change your library selection in Settings → Plex, re-run this so the new libraries get labelled too.
          </li>
        </ul>
      </div>

      {pending === "enable" && (
        <ConfirmModal
          message={(() => {
            const base =
              "This labels every item in your configured Plex libraries and restricts each shared user's view to their own content plus the shared baseline. Nothing is deleted and every user keeps the access they have today.";
            if (estimateQuery.isLoading) return `${base} Estimating duration… Continue?`;
            const est = estimateQuery.data;
            if (!est) return `${base} Continue?`;
            const items = est.itemCount.toLocaleString();
            return `${base} About ${items} items to label — estimated ~${formatDuration(est.estimatedSeconds * 1000)}. Continue?`;
          })()}
          title="Turn on personalization?"
          confirmLabel="Turn on"
          onConfirm={runEnable}
          onCancel={() => setPending(null)}
        />
      )}
      {pending === "disable" && (
        <ConfirmModal
          message="This deletes all per-user collections (Because You Watched, etc.) and restores every user's previous sharing settings — leaving your server as if personalization was never enabled. Continue?"
          title="Turn off personalization?"
          confirmLabel="Turn off"
          danger
          onConfirm={runDisable}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
