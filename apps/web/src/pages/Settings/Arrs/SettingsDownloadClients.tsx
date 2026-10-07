import { useEffect, useMemo, useState } from "react";
import { DOWNLOAD_CLIENT_KINDS, DOWNLOAD_CLIENT_META, type DownloadClientKind } from "@tinkerbell/contracts";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import UnsavedBanner from "#components/UnsavedBanner";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import { FormSkeleton } from "#components/Skeleton";
import CardSection from "#components/CardSection";
import styles from "#pages/Settings/Settings.module.css";

/**
 * SABnzbd, NZBGet, qBittorrent, Transmission and Deluge, so the Downloads page
 * can show what each is really doing and pause or resume it.
 *
 * Entered here rather than read from Radarr or Sonarr: the *Arrs mask every
 * download client password and API key in their API, so the connection they
 * hold can't be reused.
 */

interface ClientForm {
  id: string;
  kind: DownloadClientKind;
  name: string;
  url: string;
  username?: string;
  secret?: string;
}

/** Stable, and not a UUID: it goes in export files and health history. */
function newId(kind: string): string {
  return `${kind}-${Date.now().toString(36)}`;
}

export default function SettingsDownloadClients() {
  const [clients, setClients] = useState<ClientForm[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [adding, setAdding] = useState<DownloadClientKind>("sabnzbd");
  const { addToast } = useToast();
  const utils = trpc.useUtils();

  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const saveConfigMutation = trpc.config.save.useMutation();
  const testMutation = trpc.downloadClients.test.useMutation();

  const saved = useMemo(() => (configQuery.data?.global_download_clients ?? []) as ClientForm[], [configQuery.data]);
  useEffect(() => setClients(saved), [saved]);

  const isDirty = JSON.stringify(clients) !== JSON.stringify(saved);
  useUnsavedChanges(isDirty);

  const update = (id: string, patch: Partial<ClientForm>) =>
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const add = () => {
    const meta = DOWNLOAD_CLIENT_META[adding];
    setClients((prev) => [...prev, { id: newId(adding), kind: adding, name: meta.label, url: "" }]);
  };

  const handleSave = async () => {
    const cleaned = clients
      .map((c) => ({ ...c, name: c.name.trim(), url: c.url.trim(), username: c.username?.trim() || undefined }))
      .filter((c) => c.name && c.url);
    if (cleaned.length !== clients.length) {
      addToast("Clients need a name and a URL. Incomplete rows were dropped.", "info");
    }
    setSaving(true);
    try {
      await saveConfigMutation.mutateAsync({ global_download_clients: cleaned });
      await Promise.all([
        utils.config.get.invalidate(),
        utils.downloadClients.list.invalidate(),
        utils.downloadClients.overview.invalidate(),
      ]);
      addToast("Download clients saved", "success");
    } catch (err) {
      addToast(`Failed to save: ${(err as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  /** Tests what is in the form, saved or not. */
  const handleTest = async (client: ClientForm) => {
    if (!client.url.trim()) {
      addToast("Enter a URL first", "error");
      return;
    }
    setTesting(client.id);
    try {
      const isSaved = saved.some((s) => s.id === client.id);
      const { version } = await testMutation.mutateAsync({
        id: isSaved ? client.id : undefined,
        name: isSaved ? client.name : undefined,
        kind: client.kind,
        url: client.url.trim(),
        username: client.username?.trim() || undefined,
        secret: client.secret || undefined,
      });
      addToast(`Connected to ${DOWNLOAD_CLIENT_META[client.kind].label} ${version}`, "success");
    } catch (err) {
      addToast(`Connection test failed: ${(err as Error).message}`, "error");
    } finally {
      setTesting(null);
      utils.health.status.invalidate();
    }
  };

  if (configQuery.isLoading) return <FormSkeleton rows={3} />;

  return (
    <div className={styles.form}>
      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Download clients">
        <p className={styles.hint}>
          Shown on the Downloads page with their live state, and paused or resumed from there.
        </p>

        {clients.length === 0 && <p className={styles.hint}>No download clients.</p>}

        {clients.map((client) => {
          const meta = DOWNLOAD_CLIENT_META[client.kind];
          return (
            <div key={client.id} className={styles.group}>
              <label className={styles.field}>
                <span className={styles.label}>Name</span>
                <input
                  className={styles.input}
                  value={client.name}
                  onChange={(e) => update(client.id, { name: e.target.value })}
                />
                <span className={styles.hint}>
                  Shown on the Downloads page, and in health checks as {meta.label} ({client.name || "…"}).
                </span>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Client</span>
                <select
                  className={styles.input}
                  value={client.kind}
                  onChange={(e) => update(client.id, { kind: e.target.value as DownloadClientKind })}
                >
                  {DOWNLOAD_CLIENT_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {DOWNLOAD_CLIENT_META[kind].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>URL</span>
                <input
                  className={styles.input}
                  value={client.url}
                  placeholder={meta.urlPlaceholder}
                  onChange={(e) => update(client.id, { url: e.target.value })}
                />
                <span className={styles.hint}>Include any URL base the client is served under.</span>
              </label>
              {meta.username !== "none" && (
                <label className={styles.field}>
                  <span className={styles.label}>Username{meta.username === "optional" ? " (optional)" : ""}</span>
                  <input
                    className={styles.input}
                    value={client.username ?? ""}
                    autoComplete="off"
                    onChange={(e) => update(client.id, { username: e.target.value })}
                  />
                </label>
              )}
              <label className={styles.field}>
                <span className={styles.label}>
                  {meta.secretLabel}
                  {meta.secretRequired ? "" : " (optional)"}
                </span>
                <input
                  className={styles.input}
                  type="password"
                  autoComplete="new-password"
                  value={client.secret ?? ""}
                  onChange={(e) => update(client.id, { secret: e.target.value })}
                />
              </label>
              <div className={styles.buttons}>
                <button
                  type="button"
                  className={styles.buttonSecondary}
                  onClick={() => handleTest(client)}
                  disabled={testing === client.id}
                >
                  {testing === client.id ? "Testing…" : "Test Connection"}
                </button>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => setClients((prev) => prev.filter((c) => c.id !== client.id))}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}

        <div className={styles.buttons}>
          <select
            className={styles.input}
            value={adding}
            aria-label="Client to add"
            onChange={(e) => setAdding(e.target.value as DownloadClientKind)}
          >
            {DOWNLOAD_CLIENT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {DOWNLOAD_CLIENT_META[kind].label}
              </option>
            ))}
          </select>
          <button type="button" className={styles.button} onClick={add}>
            Add client
          </button>
          <button type="button" className={styles.button} onClick={handleSave} disabled={saving || !isDirty}>
            {saving ? "Saving…" : "Save"}
          </button>
          <UnsavedBanner visible={isDirty} />
        </div>
      </CardSection>
    </div>
  );
}
