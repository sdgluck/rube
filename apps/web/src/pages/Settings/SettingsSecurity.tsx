import { useState } from "react";
import { trpc } from "#/trpc";
import SettingsPageHeader from "./SettingsPageHeader";
import ConfirmModal from "#components/ConfirmModal";
import ErrorState from "#components/ErrorState";
import SettingsPageLink from "#components/SettingsPageLink";
import { useToast } from "#components/Toast";
import styles from "./SettingsSecurity.module.css";

export default function SettingsSecurity() {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const statusQuery = trpc.auth.status.useQuery();
  const enableMutation = trpc.auth.enable.useMutation();
  const disableMutation = trpc.auth.disable.useMutation();
  const logoutMutation = trpc.auth.logout.useMutation();
  const setAllowedMutation = trpc.auth.setAllowedUserIds.useMutation();
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

  function revokeExtras() {
    setAllowedMutation.mutate(
      { userIds: [] },
      {
        onSuccess: () => {
          addToast("Additional admins removed", "success");
          utils.auth.status.invalidate();
        },
        onError: (err) => addToast(err.message, "error"),
      },
    );
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
            {/* Extra admins are shown whenever there are any. This list is the
                one grant that isn't the owner, so leaving it invisible would
                mean an entry nobody ever looks at. */}
            {!!status.allowedUserIds?.length && (
              <p className={styles.hint}>
                Also allowed to sign in: {status.allowedUserIds.length} additional Plex{" "}
                {status.allowedUserIds.length === 1 ? "account" : "accounts"} ({status.allowedUserIds.join(", ")}).{" "}
                <button type="button" className={styles.linkButton} onClick={revokeExtras}>
                  Remove
                </button>
              </p>
            )}
            {status.configured && status.disabledByEnv && (
              <p className={styles.warn}>
                Authentication is configured but bypassed: <code>RUBE_DISABLE_AUTH</code> is set on the server. Unset it
                and restart once you can sign in again.
              </p>
            )}
            {!status.configured && status.ownerResolved && (
              <p className={styles.hint}>
                Only {status.ownerUsername}, this server's Plex owner, will be able to sign in.
              </p>
            )}
            {!status.configured && !status.ownerResolved && (
              <p className={styles.hint}>
                Only this server's Plex owner will sign in. Needs a token in <SettingsPageLink to="/settings/plex" />.
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
