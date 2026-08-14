import { useState } from "react";
import { trpc } from "#/trpc";
import SettingsPageHeader from "./SettingsPageHeader";
import ConfirmModal from "#components/ConfirmModal";
import ErrorState from "#components/ErrorState";
import { useToast } from "#components/Toast";
import styles from "./SettingsSecurity.module.css";

export default function SettingsSecurity() {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const statusQuery = trpc.auth.status.useQuery();
  const enableMutation = trpc.auth.enable.useMutation();
  const disableMutation = trpc.auth.disable.useMutation();
  const logoutMutation = trpc.auth.logout.useMutation();
  const [confirming, setConfirming] = useState<"enable" | "disable" | null>(null);

  if (statusQuery.error && !statusQuery.data) {
    return <ErrorState title="Couldn't load the auth status" error={statusQuery.error} onRetry={statusQuery.refetch} />;
  }
  const status = statusQuery.data;
  if (!status) return null;

  function enable() {
    setConfirming(null);
    enableMutation.mutate(undefined, {
      onSuccess: ({ ownerUsername }) => {
        addToast(`Authentication on — sign in as ${ownerUsername}`, "success");
        utils.auth.status.invalidate();
      },
      onError: (err) => addToast(err.message, "error"),
    });
  }

  function disable() {
    setConfirming(null);
    disableMutation.mutate(undefined, {
      onSuccess: () => {
        addToast("Authentication off", "success");
        utils.auth.status.invalidate();
      },
      onError: (err) => addToast(err.message, "error"),
    });
  }

  function signOut() {
    logoutMutation.mutate(undefined, {
      // Reload rather than invalidate: the whole cache belongs to a session
      // that no longer exists, and the gate should re-run from scratch.
      onSuccess: () => window.location.reload(),
      onError: (err) => addToast(err.message, "error"),
    });
  }

  return (
    <div className={styles.stack}>
      <SettingsPageHeader title="Security" />

      <p className={styles.lede}>
        With authentication on, the admin app asks for a Plex sign-in and only the account that owns this Plex server
        gets in. With it off, anyone who can reach this port can call every mutation — which is why the server binds to
        loopback by default.
      </p>

      <div className={styles.card}>
        <div className={styles.row}>
          <div className={styles.statusBlock}>
            <div className={styles.statusLine}>
              <span className={`${styles.pill} ${status.required ? styles.pillOk : styles.pillNeutral}`}>
                <span className={styles.pillDot} />
                {status.required ? "On" : "Off"}
              </span>
              {status.signedIn && <span className={styles.muted}>signed in as {status.username}</span>}
            </div>
            {status.configured && status.disabledByEnv && (
              <p className={styles.warn}>
                Authentication is configured but bypassed: <code>TINKERBELL_DISABLE_AUTH</code> is set on the server.
                Unset it and restart once you can sign in again.
              </p>
            )}
            {!status.configured && status.ownerResolved && (
              <p className={styles.hint}>
                Turning this on will let {status.ownerUsername} — the owner of this Plex server — sign in, and nobody
                else.
              </p>
            )}
            {!status.configured && !status.ownerResolved && (
              <p className={styles.hint}>
                Tinkerbell will ask plex.tv who owns this server when you turn this on. It needs a working Plex token in
                Settings → Plex first.
              </p>
            )}
          </div>

          <div className={styles.actions}>
            {status.signedIn && (
              <button type="button" className={styles.secondary} onClick={signOut} disabled={logoutMutation.isPending}>
                Sign out
              </button>
            )}
            {status.configured ? (
              <button
                type="button"
                className={styles.danger}
                onClick={() => setConfirming("disable")}
                disabled={disableMutation.isPending}
              >
                Turn off
              </button>
            ) : (
              <button
                type="button"
                className={styles.primary}
                onClick={() => setConfirming("enable")}
                disabled={enableMutation.isPending}
              >
                {enableMutation.isPending ? "Checking with Plex…" : "Turn on"}
              </button>
            )}
          </div>
        </div>
      </div>

      {confirming === "enable" && (
        <ConfirmModal
          title="Turn on authentication?"
          message="You'll be asked to sign in with Plex. Only the account that owns this server will be let in — make sure you can sign into plex.tv with it before continuing."
          confirmLabel="Turn on"
          onConfirm={enable}
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming === "disable" && (
        <ConfirmModal
          title="Turn off authentication?"
          message="Anyone who can reach this port will be able to call every mutation, including deleting collections."
          confirmLabel="Turn off"
          danger
          onConfirm={disable}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
