/**
 * Settings → Portal → Address: the portal's public URL (`user_app_public_url`).
 *
 * The key was read in three places — Plex sign-in's forward URL, the link in
 * cleanup warnings, and the portal preroll — and settable from none of them,
 * so every one of those quietly ran on its fallback. It gets its own tab
 * because it belongs to the portal as a whole, not to any one feature in it.
 */
import { useEffect, useState } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import ErrorState from "#components/ErrorState";
import styles from "../Personalization.module.css";

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
      <p className={styles.lede}>
        The address your users reach the portal at — from their phones, outside your network if you expose it. Plex
        sign-in returns people here, cleanup warnings link to it, and the portal preroll shows it on screen.
      </p>

      <div className={styles.card}>
        <label className={styles.field}>
          <span className={styles.label}>Public URL</span>
          <input
            className={styles.input}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={`http://${window.location.hostname}:3100`}
          />
          <span className={styles.hint}>
            The portal port (3100 by default), or whatever your reverse proxy serves it at — not this admin page. Leave
            blank and sign-in uses whichever address the visitor arrived from, but cleanup warnings and the preroll have
            nothing to show.
          </span>
        </label>

        <div>
          <button type="button" className={styles.primary} onClick={save} disabled={!dirty || saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save address"}
          </button>
        </div>
      </div>
    </div>
  );
}
