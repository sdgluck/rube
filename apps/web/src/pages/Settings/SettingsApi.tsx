import { useState } from "react";
import { trpc } from "#/trpc";
import CardSection from "#components/CardSection";
import ConfirmModal from "#components/ConfirmModal";
import ErrorState from "#components/ErrorState";
import RelativeTime from "#components/RelativeTime";
import { useToast } from "#components/Toast";
import SettingsPageHeader from "./SettingsPageHeader";
import settings from "./Settings.module.css";
import styles from "./SettingsApi.module.css";

/**
 * Settings → API & MCP: keys for the read-only agent API.
 *
 * The key is shown exactly once, in the card that appears after creating it,
 * because only its hash is kept. The connection snippets are filled in with
 * that key while it is on screen so the one moment the user has it is also the
 * moment they can paste a working command; afterwards they show a placeholder.
 */
export default function SettingsApi() {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const keysQuery = trpc.apiKeys.list.useQuery();
  const createMutation = trpc.apiKeys.create.useMutation();
  const revokeMutation = trpc.apiKeys.revoke.useMutation();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);

  // The admin server serves the API, and this page is served by the admin
  // server, so its own origin is the address to give an agent.
  const origin = window.location.origin;
  const shownKey = created?.key ?? "<your key>";

  function create(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate(
      { name },
      {
        onSuccess: (res) => {
          setCreated({ name: res.name, key: res.key });
          setName("");
          utils.apiKeys.list.invalidate();
        },
        onError: (err) => addToast(err.message, "error"),
      },
    );
  }

  function revoke() {
    if (!revoking) return;
    const target = revoking;
    setRevoking(null);
    revokeMutation.mutate(
      { id: target.id },
      {
        onSuccess: () => {
          addToast(`Revoked "${target.name}"`, "success");
          utils.apiKeys.list.invalidate();
        },
        onError: (err) => addToast(err.message, "error"),
      },
    );
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => addToast("Copied", "success"),
      () => addToast("Couldn't copy — select the text instead", "error"),
    );
  }

  const snippets = [
    {
      label: "Claude Code",
      text: `claude mcp add --transport http rube ${origin}/mcp --header "Authorization: Bearer ${shownKey}"`,
    },
    {
      label: "MCP client config (JSON)",
      text: JSON.stringify(
        {
          mcpServers: {
            rube: { type: "http", url: `${origin}/mcp`, headers: { Authorization: `Bearer ${shownKey}` } },
          },
        },
        null,
        2,
      ),
    },
    {
      label: "HTTP",
      text: `curl -H "Authorization: Bearer ${shownKey}" ${origin}/api/v1/tools/get_overview`,
    },
  ];

  return (
    <div className={styles.stack}>
      <SettingsPageHeader title="API & MCP" />

      <CardSection className={settings.group} titleClassName={settings.groupTitle} title="Keys">
        <p className={settings.hint}>
          A key lets an AI assistant or script read this instance — rules, runs and logs, collections, media, jobs,
          health, events and settings (secrets stay redacted). It can't change anything. Make one key per client so you
          can revoke them separately.
        </p>

        <form className={styles.createRow} onSubmit={create}>
          <input
            className={settings.input}
            aria-label="Key name"
            placeholder="Name, e.g. Claude Desktop"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className={styles.primary} disabled={!name.trim() || createMutation.isPending}>
            Create key
          </button>
        </form>

        {created && (
          <div className={styles.reveal} role="status">
            <p className={styles.revealTitle}>Copy the key for “{created.name}” now — it won't be shown again.</p>
            <div className={styles.keyRow}>
              <code className={styles.key}>{created.key}</code>
              <button type="button" className={styles.secondary} onClick={() => copy(created.key)}>
                Copy
              </button>
              <button type="button" className={styles.ghost} onClick={() => setCreated(null)}>
                Done
              </button>
            </div>
          </div>
        )}

        {keysQuery.error && !keysQuery.data ? (
          <ErrorState title="Couldn't load API keys" error={keysQuery.error} onRetry={keysQuery.refetch} />
        ) : keysQuery.data && keysQuery.data.length > 0 ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Created</th>
                <th>Last used</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {keysQuery.data.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td>
                    <code className={styles.prefix}>{k.prefix}…</code>
                  </td>
                  <td>
                    <RelativeTime timestamp={k.createdAt} />
                  </td>
                  <td>
                    {k.lastUsedAt ? (
                      <RelativeTime timestamp={k.lastUsedAt} />
                    ) : (
                      <span className={styles.muted}>Never</span>
                    )}
                  </td>
                  <td className={styles.actionsCell}>
                    <button
                      type="button"
                      className={styles.revoke}
                      onClick={() => setRevoking({ id: k.id, name: k.name })}
                      disabled={revokeMutation.isPending}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : keysQuery.data ? (
          <p className={settings.hint}>No keys yet. The API refuses every request until one exists.</p>
        ) : null}
      </CardSection>

      <CardSection className={settings.group} titleClassName={settings.groupTitle} title="Connect">
        <p className={settings.hint}>
          MCP clients connect to <code className={styles.inline}>{origin}/mcp</code> over HTTP. Anything else can call
          the same tools as JSON under <code className={styles.inline}>{origin}/api/v1</code> — the OpenAPI description
          is at <code className={styles.inline}>/api/v1/openapi.json</code>. Send the key as{" "}
          <code className={styles.inline}>Authorization: Bearer …</code> or{" "}
          <code className={styles.inline}>X-Api-Key</code>.
        </p>
        {snippets.map((s) => (
          <div key={s.label} className={settings.field}>
            <div className={styles.snippetHead}>
              <span className={settings.label}>{s.label}</span>
              <button type="button" className={styles.copyLink} onClick={() => copy(s.text)}>
                Copy
              </button>
            </div>
            <pre className={styles.snippet}>{s.text}</pre>
          </div>
        ))}
      </CardSection>

      {revoking && (
        <ConfirmModal
          title={`Revoke "${revoking.name}"?`}
          message="Anything using this key stops working immediately. This can't be undone — you'd make a new key instead."
          confirmLabel="Revoke"
          danger
          onConfirm={revoke}
          onCancel={() => setRevoking(null)}
        />
      )}
    </div>
  );
}
