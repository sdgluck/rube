/**
 * Settings → Portal → Address: the portal's public URL (`user_app_public_url`).
 *
 * The key was read in three places — Plex sign-in's forward URL, the link in
 * cleanup warnings, and the portal preroll — and settable from none of them,
 * so every one of those quietly ran on its fallback. It gets its own tab
 * because it belongs to the portal as a whole, not to any one feature in it.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import ErrorState from "#components/ErrorState";
import styles from "../Personalization.module.css";
import local from "./SettingsPortalAddress.module.css";
import { nativeConnectLink } from "@tinkerbell/contracts";
import QrCode from "#components/QrCode";

const USED_WITHOUT_FALLBACK = ["Cleanup warnings", "Portal preroll"];

export default function SettingsPortalAddress() {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const configQuery = trpc.config.get.useQuery();
  const saveMutation = trpc.config.save.useMutation();
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (configQuery.data) setUrl(configQuery.data.user_app_public_url ?? "");
  }, [configQuery.data]);

  if (configQuery.error && !configQuery.data) {
    return (
      <ErrorState
        title="Couldn't load the portal address"
        error={configQuery.error}
        onRetry={() => configQuery.refetch()}
      />
    );
  }

  const saved = configQuery.data?.user_app_public_url ?? "";
  // The host the admin server answers on.
  const host = window.location.hostname;
  const suggestion = `http://${host}:3100`;
  const blank = url.trim() === "";
  const dirty = url.trim() !== saved;

  function save() {
    saveMutation.mutate(
      { user_app_public_url: url.trim() },
      {
        onSuccess: () => {
          addToast("Portal address saved", "success");
          utils.config.get.invalidate();
          utils.prerolls.portalCard.invalidate();
        },
        onError: (err) => addToast(err.message, "error"),
      },
    );
  }

  return (
    <div className={styles.stack}>
      <div className={styles.card}>
        <label className={styles.field}>
          <span className={styles.label}>Public URL</span>
          <input
            className={styles.input}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={suggestion}
          />
          <span className={styles.hint}>The portal port or your reverse proxy — not this admin page.</span>
        </label>

        {blank && (
          <div>
            <button type="button" className={styles.secondary} onClick={() => setUrl(suggestion)}>
              Use {suggestion}
            </button>
          </div>
        )}

        {/* Sign-in falls back to the visitor's own address when this is blank;
            the other two have nothing to fall back on, so they are the ones
            that get the warning mark. */}
        <p className={styles.hint}>
          Used by: <Check size="1.2rem" aria-hidden /> Plex sign-in
          {USED_WITHOUT_FALLBACK.map((name) => (
            <span key={name}>
              {" · "}
              {blank ? (
                <AlertTriangle size="1.2rem" className={styles.warnMark} aria-label="needs an address" />
              ) : (
                <Check size="1.2rem" aria-hidden />
              )}{" "}
              {name}
            </span>
          ))}
        </p>

        <div>
          <button type="button" className={styles.primary} onClick={save} disabled={!dirty || saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save address"}
          </button>
        </div>
      </div>

      {/* The portal app's connect code — for the admin to share with the
          people they share with, so none of them types the address. Only for a
          saved address: the suggestion may not be one their phones can reach. */}
      {saved && (
        <div className={styles.card}>
          <span className={styles.label}>Tinkerbell app</span>
          <p className={styles.hint}>People with the Tinkerbell app can scan this to connect to the address above.</p>
          <div className={local.qr}>
            <QrCode
              value={nativeConnectLink({ portal: saved })}
              label="QR code that connects the Tinkerbell app to this server's portal"
            />
          </div>
        </div>
      )}
    </div>
  );
}
