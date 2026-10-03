import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Download, Upload } from "lucide-react";
import { BUNDLE_PARTS, formatFileSize, type BundlePart, type ImportResolution } from "@tinkerbell/contracts";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import CardSection from "#components/CardSection";
import ConfirmModal from "#components/ConfirmModal";
import RelativeTime from "#components/RelativeTime";
import ErrorState from "#components/ErrorState";
import { describeCron } from "#/utils";
import SettingsPageHeader from "./SettingsPageHeader";
import settings from "./Settings.module.css";
import local from "./SettingsBackup.module.css";

const DEFAULT_KEEP = 7;

const PART_LABELS: Record<BundlePart, string> = {
  rules: "Rules",
  jobs: "Job schedules",
  overlayPresets: "Overlay presets",
  arrQualityProfiles: "Quality profile presets",
  overlayConfigs: "Overlay layouts",
  config: "Settings",
};

interface PreviewItem {
  kind: string;
  key: string;
  label: string;
  verdict: "new" | "identical" | "differs";
  changed?: string[];
  blocked?: string;
}

interface Preview {
  items: PreviewItem[];
  tinkerbellVersion: string;
  exportedAt: number;
  sameServer: boolean;
  containsSecrets: boolean;
  unresolvedTags: { ruleName: string; field: string; value: string; sectionTitle: string }[];
  missingSections: string[];
}

interface Summary {
  created: number;
  overwritten: number;
  duplicated: number;
  skipped: number;
  failed: { key: string; error: string }[];
}

/** The routes below aren't tRPC — see `apps/server/src/portability.ts`. */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(payload.error ?? `Request failed (${res.status})`);
  return payload;
}

export default function SettingsBackup() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const utils = trpc.useUtils();

  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const backupsQuery = trpc.backups.list.useQuery(undefined, { refetchOnWindowFocus: false });
  const saveMutation = trpc.config.save.useMutation();
  const startJob = trpc.jobs.start.useMutation();
  // The schedule is the backup job's own. It is shown here read-only and
  // edited on the job page, where the cron picker and its preview live — a
  // second free-text cron field here could only ever be the worse editor.
  const jobsQuery = trpc.jobs.list.useQuery(undefined, { refetchOnWindowFocus: false });
  const backupSchedule = jobsQuery.data?.find((j) => j.id === "backup")?.schedule;

  // ── Backups ───────────────────────────────────────────────────────────────
  const [enabled, setEnabled] = useState(true);
  const [dir, setDir] = useState("");
  const [keep, setKeep] = useState(DEFAULT_KEEP);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!configQuery.data) return;
    setEnabled(configQuery.data.backup_enabled ?? true);
    setDir(configQuery.data.backup_dir ?? "");
    setKeep(configQuery.data.backup_keep_count ?? DEFAULT_KEEP);
  }, [configQuery.data]);

  const isDirty = useMemo(() => {
    const d = configQuery.data;
    if (!d) return false;
    return (
      enabled !== (d.backup_enabled ?? true) ||
      dir !== (d.backup_dir ?? "") ||
      keep !== (d.backup_keep_count ?? DEFAULT_KEEP)
    );
  }, [enabled, dir, keep, configQuery.data]);

  useUnsavedChanges(isDirty);

  async function handleSave() {
    setSaving(true);
    try {
      await saveMutation.mutateAsync({
        backup_enabled: enabled,
        backup_dir: dir,
        backup_keep_count: keep,
      });
      addToast("Backup settings saved", "success");
      await utils.config.get.invalidate();
      await utils.backups.list.invalidate();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to save backup settings", "error");
    } finally {
      setSaving(false);
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  const [parts, setParts] = useState<Set<BundlePart>>(new Set(BUNDLE_PARTS));
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [confirmSecrets, setConfirmSecrets] = useState(false);

  function download() {
    const query = new URLSearchParams({ parts: [...parts].join(",") });
    if (includeSecrets) query.set("includeSecrets", "1");
    // A plain navigation rather than fetch-and-blob: the server sets
    // `Content-Disposition`, so the browser names the file and the download
    // shows up in the normal place with normal progress.
    window.location.href = `/api/portability/export?${query}`;
  }

  // ── Import ────────────────────────────────────────────────────────────────
  const fileInput = useRef<HTMLInputElement>(null);
  const [bundle, setBundle] = useState<unknown>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ImportResolution>>({});
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);

  async function pickFile(file: File) {
    setImportError(null);
    setSummary(null);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const result = await postJson<Preview>("/api/portability/import/preview", parsed);
      setBundle(parsed);
      setPreview(result);
      // Everything defaults to skip. The differing items are the ones somebody
      // has to decide about, and defaulting them to "overwrite" would make the
      // preview a formality rather than a decision.
      setDecisions({});
    } catch (err) {
      setPreview(null);
      setBundle(null);
      setImportError(err instanceof Error ? err.message : "Couldn't read that file.");
    }
  }

  async function apply() {
    setImporting(true);
    try {
      const result = await postJson<Summary>("/api/portability/import/apply", { bundle, decisions });
      setSummary(result);
      setPreview(null);
      setBundle(null);
      addToast("Import finished", "success");
      await utils.invalidate();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "The import failed.");
    } finally {
      setImporting(false);
      setConfirmApply(false);
    }
  }

  const differing = preview?.items.filter((i) => i.verdict === "differs" && !i.blocked) ?? [];
  const arriving = preview?.items.filter((i) => i.verdict === "new" && !i.blocked) ?? [];
  const unchanged = preview?.items.filter((i) => i.verdict === "identical").length ?? 0;
  const blocked = preview?.items.filter((i) => i.blocked) ?? [];

  return (
    <div className={settings.form}>
      <SettingsPageHeader title="Backup & Restore" />

      {/* ── Backups ─────────────────────────────────────────────────────── */}
      <CardSection className={settings.group} titleClassName={settings.groupTitle} title="Automatic backups">
        <p className={settings.hint}>The whole database, including playback history and undo snapshots.</p>

        <label className={settings.checkRow}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className={settings.label}>Back up the database on a schedule</span>
        </label>

        <div className={settings.field}>
          <label className={settings.label} htmlFor="backup-dir">
            Directory
          </label>
          <input
            id="backup-dir"
            className={settings.input}
            value={dir}
            placeholder={backupsQuery.data?.directory ?? "<data dir>/backups"}
            onChange={(e) => setDir(e.target.value)}
          />
          {/* Describes the saved directory, so it hides while another is being typed. */}
          {backupsQuery.data?.directoryMount && dir === (configQuery.data?.backup_dir ?? "") && (
            <span
              className={`${settings.status} ${
                backupsQuery.data.directoryMount === "mounted" ? settings.statusOk : settings.statusWarn
              }`}
            >
              <span className={settings.statusDot} aria-hidden="true" />
              {backupsQuery.data.directoryMount === "mounted"
                ? "On a mounted volume"
                : "Inside the container — lost when it's replaced"}
            </span>
          )}
        </div>

        <div className={settings.field}>
          <span className={settings.label}>Schedule</span>
          <p className={settings.readout}>
            {backupSchedule ? describeCron(backupSchedule) : "…"} · <Link to="/jobs/backup">Edit schedule →</Link>
          </p>
        </div>

        <div className={settings.field}>
          <label className={settings.label} htmlFor="backup-keep">
            Keep
          </label>
          <div className={settings.suffixRow}>
            <input
              id="backup-keep"
              type="number"
              min={1}
              max={365}
              className={settings.input}
              value={keep}
              onChange={(e) => setKeep(Math.max(1, Number(e.target.value) || 1))}
            />
            <span className={settings.suffix}>most recent backups</span>
          </div>
          <p className={settings.hint}>Pruned only after a successful backup.</p>
        </div>

        <div className={settings.buttons}>
          <button type="button" className={settings.button} disabled={!isDirty || saving} onClick={handleSave}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className={settings.buttonSecondary}
            disabled={startJob.isPending}
            onClick={() =>
              startJob.mutate(
                { jobId: "backup" },
                {
                  onSuccess: ({ runId }) => navigate(`/jobs/runs/${runId}`),
                  onError: (err) => addToast(err.message, "error"),
                },
              )
            }
          >
            Back up now
          </button>
        </div>
      </CardSection>

      <CardSection className={settings.group} titleClassName={settings.groupTitle} title="Existing backups">
        {backupsQuery.error && (
          <ErrorState
            inline
            title="Couldn't list backups"
            error={backupsQuery.error}
            onRetry={() => backupsQuery.refetch()}
          />
        )}
        {backupsQuery.data?.files.length === 0 && <p className={settings.hint}>No backups yet.</p>}
        {(backupsQuery.data?.files.length ?? 0) > 0 && (
          <ul className={local.fileList}>
            {backupsQuery.data!.files.map((file) => (
              <li key={file.name}>
                <span className={local.fileName}>{file.name}</span>
                <span className={local.fileMeta}>
                  {formatFileSize(file.sizeBytes)} · <RelativeTime timestamp={file.createdAt} />
                </span>
                <a className={local.downloadLink} href={`/api/backups/${encodeURIComponent(file.name)}`}>
                  <Download size={13} aria-hidden /> Download
                </a>
              </li>
            ))}
          </ul>
        )}

        <div className={local.restoreNote}>
          <strong>Restoring is a manual procedure, on purpose.</strong>
          <ol>
            <li>Stop the Tinkerbell container.</li>
            <li>
              Decompress the backup: <code>gunzip tinkerbell-….db.gz</code>
            </li>
            <li>
              Replace <code>tinkerbell.db</code> in your data directory with it, and delete any{" "}
              <code>tinkerbell.db-wal</code> and <code>tinkerbell.db-shm</code> beside it.
            </li>
            <li>Start the container.</li>
          </ol>
        </div>
      </CardSection>

      {/* ── Export ──────────────────────────────────────────────────────── */}
      <CardSection className={settings.group} titleClassName={settings.groupTitle} title="Export">
        <p className={settings.hint}>Your configuration as one JSON file, portable to another server.</p>

        <div className={local.partGrid}>
          {BUNDLE_PARTS.map((part) => (
            <label key={part} className={settings.checkRow}>
              <input
                type="checkbox"
                checked={parts.has(part)}
                onChange={(e) =>
                  setParts((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(part);
                    else next.delete(part);
                    return next;
                  })
                }
              />
              <span className={settings.label}>{PART_LABELS[part]}</span>
            </label>
          ))}
        </div>

        <label className={settings.checkRow}>
          <input
            type="checkbox"
            checked={includeSecrets}
            onChange={(e) => (e.target.checked ? setConfirmSecrets(true) : setIncludeSecrets(false))}
          />
          <span>
            <span className={settings.label}>Include API keys and tokens</span>
            <span className={settings.hint}>Written in plain text — never attach the file to an issue.</span>
          </span>
        </label>

        <button type="button" className={settings.button} disabled={parts.size === 0} onClick={download}>
          <Download size={14} aria-hidden /> Download export
        </button>
      </CardSection>

      {/* ── Import ──────────────────────────────────────────────────────── */}
      <CardSection className={settings.group} titleClassName={settings.groupTitle} title="Import">
        <p className={settings.hint}>Previewed first; nothing is written until you confirm.</p>

        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className={local.fileInput}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void pickFile(file);
            // Cleared so picking the same file twice re-runs the preview,
            // which is what somebody does after fixing it in an editor.
            e.target.value = "";
          }}
        />
        <button type="button" className={settings.buttonSecondary} onClick={() => fileInput.current?.click()}>
          <Upload size={14} aria-hidden /> Choose a bundle…
        </button>

        {importError && <div className={local.error}>{importError}</div>}

        {summary && (
          <div className={local.summary}>
            Imported: {summary.created} created, {summary.overwritten} replaced, {summary.duplicated} duplicated,{" "}
            {summary.skipped} skipped.
            {summary.failed.length > 0 && (
              <ul>
                {summary.failed.map((f) => (
                  <li key={f.key}>
                    {f.key}: {f.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {preview && (
          <div className={local.preview}>
            <p className={settings.hint}>
              Exported by Tinkerbell {preview.tinkerbellVersion} <RelativeTime timestamp={preview.exportedAt} />
              {preview.sameServer ? " — from this server." : " — from a different server."}
            </p>

            {preview.containsSecrets && (
              <div className={local.warn}>
                This bundle contains credentials in plain text. Delete the file when you're done with it.
              </div>
            )}
            {preview.missingSections.length > 0 && (
              <div className={local.warn}>
                It refers to libraries this server doesn't have: {preview.missingSections.join(", ")}. Rules scoped to
                them will import but match nothing until the names line up.
              </div>
            )}
            {preview.unresolvedTags.length > 0 && (
              <div className={local.warn}>
                {preview.unresolvedTags.length} tag value{preview.unresolvedTags.length === 1 ? "" : "s"} couldn't be
                matched on this server (for example “{preview.unresolvedTags[0].value}” on{" "}
                {preview.unresolvedTags[0].ruleName}). Those clauses will match nothing until you edit them.
              </div>
            )}

            <p className={local.counts}>
              <strong>{arriving.length}</strong> new · <strong>{differing.length}</strong> differ ·{" "}
              <strong>{unchanged}</strong> already identical
              {blocked.length > 0 && (
                <>
                  {" "}
                  · <strong>{blocked.length}</strong> can't be imported
                </>
              )}
            </p>

            {differing.length > 0 && (
              <table className={local.table}>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>What differs</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {differing.map((item) => (
                    <tr key={item.key}>
                      <td>
                        <span className={local.kind}>{item.kind}</span> {item.label}
                      </td>
                      <td className={local.changed}>{item.changed?.join(", ") || "—"}</td>
                      <td>
                        <select
                          className={settings.input}
                          value={decisions[item.key] ?? "skip"}
                          onChange={(e) =>
                            setDecisions((prev) => ({ ...prev, [item.key]: e.target.value as ImportResolution }))
                          }
                        >
                          <option value="skip">Keep mine</option>
                          <option value="overwrite">Replace with theirs</option>
                          {item.kind === "rule" || item.kind === "overlayPreset" ? (
                            <option value="duplicate">Keep both</option>
                          ) : null}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {blocked.length > 0 && (
              <ul className={local.blocked}>
                {blocked.map((item) => (
                  <li key={item.key}>
                    <strong>{item.label}</strong> — {item.blocked}
                  </li>
                ))}
              </ul>
            )}

            <div className={settings.buttons}>
              <button
                type="button"
                className={settings.button}
                disabled={importing}
                onClick={() => setConfirmApply(true)}
              >
                {importing ? "Importing…" : "Import"}
              </button>
              <button
                type="button"
                className={settings.buttonSecondary}
                onClick={() => {
                  setPreview(null);
                  setBundle(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </CardSection>

      {confirmSecrets && (
        <ConfirmModal
          title="Include credentials in the export?"
          message={
            "The file will contain your Plex token and every API key, in plain text. Anyone who opens it can use them."
          }
          confirmLabel="Include them"
          danger
          onConfirm={() => {
            setIncludeSecrets(true);
            setConfirmSecrets(false);
          }}
          onCancel={() => setConfirmSecrets(false)}
        />
      )}

      {confirmApply && (
        <ConfirmModal
          title="Import this bundle"
          message={
            `${arriving.length} item(s) will be created. ` +
            `${Object.values(decisions).filter((d) => d === "overwrite").length} existing item(s) will be replaced — ` +
            "the old versions stay in Change History."
          }
          confirmLabel="Import"
          onConfirm={() => void apply()}
          onCancel={() => setConfirmApply(false)}
        />
      )}
    </div>
  );
}
