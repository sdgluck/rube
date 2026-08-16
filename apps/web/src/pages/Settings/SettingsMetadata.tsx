import { useEffect, useMemo, useState } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import CardSection from "#components/CardSection";
import ConfirmModal from "#components/ConfirmModal";
import SettingsPageHeader from "./SettingsPageHeader";
import settings from "./Settings.module.css";
import styles from "./SettingsMetadata.module.css";

const DEFAULT_MAX_WRITES = 2000;
const DEFAULT_RETENTION_DAYS = 90;

/**
 * The master switch for rule-driven metadata writes, and the revert history.
 *
 * Its own pane for the same reason `Cleanup` has one: it needs to be findable
 * in a hurry. But the history below it is the part that makes the feature
 * usable at all — a metadata write cannot be regenerated the way a collection
 * can, so "which run changed this, and can I take it back" is the first
 * question anyone asks.
 */
export default function SettingsMetadata() {
  const [enabled, setEnabled] = useState(false);
  const [maxWrites, setMaxWrites] = useState(DEFAULT_MAX_WRITES);
  const [retentionDays, setRetentionDays] = useState(DEFAULT_RETENTION_DAYS);
  const [saving, setSaving] = useState(false);

  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const saveMutation = trpc.config.save.useMutation();
  const batchesQuery = trpc.metadata.batches.useQuery(undefined, { refetchOnWindowFocus: false });
  const revertMutation = trpc.metadata.undo.useMutation();
  const [confirming, setConfirming] = useState<{ batchId: string; writes: number } | null>(null);

  useEffect(() => {
    if (configQuery.data) {
      setEnabled(configQuery.data.metadata_writes_enabled ?? false);
      setMaxWrites(configQuery.data.metadata_max_writes_per_day ?? DEFAULT_MAX_WRITES);
      setRetentionDays(configQuery.data.metadata_undo_retention_days ?? DEFAULT_RETENTION_DAYS);
    }
  }, [configQuery.data]);

  const isDirty = useMemo(() => {
    if (!configQuery.data) return false;
    return (
      enabled !== (configQuery.data.metadata_writes_enabled ?? false) ||
      maxWrites !== (configQuery.data.metadata_max_writes_per_day ?? DEFAULT_MAX_WRITES) ||
      retentionDays !== (configQuery.data.metadata_undo_retention_days ?? DEFAULT_RETENTION_DAYS)
    );
  }, [enabled, maxWrites, retentionDays, configQuery.data]);

  useUnsavedChanges(isDirty);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveMutation.mutateAsync({
        metadata_writes_enabled: enabled,
        metadata_max_writes_per_day: maxWrites,
        metadata_undo_retention_days: retentionDays,
      });
      addToast("Metadata settings saved", "success");
      await utils.config.get.invalidate();
    } catch {
      addToast("Failed to save metadata settings", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleRevert = async () => {
    if (!confirming) return;
    try {
      await revertMutation.mutateAsync({ batchId: confirming.batchId });
      addToast("Revert started — watch it on the Jobs page", "success");
      await utils.metadata.batches.invalidate();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to start the revert", "error");
    } finally {
      setConfirming(null);
    }
  };

  const batches = batchesQuery.data ?? [];

  return (
    <div className={settings.form}>
      <SettingsPageHeader title="Metadata" />

      <CardSection className={settings.group} titleClassName={settings.groupTitle} title="Rule-driven metadata writes">
        <p className={styles.intro}>
          Rules whose outcome is <strong>Metadata</strong> can rewrite the fields on the items they match — sort titles,
          content ratings, studios, genres. Nothing is written unless this switch is on. It is checked every time a rule
          is about to write, not when the rule is saved, so turning it off stops work already in progress.
        </p>

        <label className={styles.switchRow}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>
            <span className={styles.switchLabel}>Allow metadata rules to write to Plex</span>
            <span className={styles.switchHint}>
              Off means every metadata rule refuses, with the reason in its run log. Editing an item by hand from its
              page still works — that switch is for the runs nobody is watching.
            </span>
          </span>
        </label>

        {enabled && (
          <div className={styles.armed} role="status">
            Metadata writing is armed. Rules that are past their preview-only setting will change fields on their next
            scheduled run.
          </div>
        )}

        <div className={settings.field}>
          <label className={settings.label} htmlFor="metadata-max">
            Most fields to change per day, across all rules
          </label>
          <input
            id="metadata-max"
            type="number"
            min={1}
            className={settings.input}
            value={maxWrites}
            onChange={(e) => setMaxWrites(Math.max(1, parseInt(e.target.value, 10) || 1))}
          />
          <p className={settings.hint}>
            A backstop over and above each rule's own limit. Per-rule caps don't compose — five rules each staying under
            two hundred can still rewrite a library in one night. Counted over a rolling 24 hours from what was actually
            written, so scheduled runs and rules you run by hand draw on the same allowance.
          </p>
        </div>

        <div className={settings.field}>
          <label className={settings.label} htmlFor="metadata-retention">
            Days to keep revert history
          </label>
          <input
            id="metadata-retention"
            type="number"
            min={1}
            className={settings.input}
            value={retentionDays}
            onChange={(e) => setRetentionDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
          />
          <p className={settings.hint}>
            How long a run stays revertible. A metadata write cannot be regenerated the way a collection can, and the
            gap between a bad nightly run and somebody noticing a title looks wrong is usually weeks rather than days.
          </p>
        </div>

        <div className={settings.buttons}>
          <button className={settings.button} onClick={handleSave} disabled={!isDirty || saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </CardSection>

      <CardSection className={settings.group} titleClassName={settings.groupTitle} title="History">
        {batches.length === 0 ? (
          <p className={styles.intro}>Nothing has written metadata yet.</p>
        ) : (
          <ul className={styles.batches}>
            {batches.map((batch) => (
              <li key={batch.batchId} className={styles.batch}>
                <div className={styles.batchMain}>
                  <span className={styles.batchSummary}>
                    Changed {batch.fields.join(", ")} on {batch.items} item{batch.items === 1 ? "" : "s"}
                  </span>
                  <span className={styles.batchMeta}>
                    {new Date(batch.appliedAt).toLocaleString()}
                    {" · "}
                    {batch.writes} field write{batch.writes === 1 ? "" : "s"}
                    {batch.ruleId ? " · from a rule" : " · edited by hand"}
                    {batch.sampleTitles.length > 0 && ` · ${batch.sampleTitles.join(", ")}`}
                  </span>
                </div>
                {batch.reverted ? (
                  <span className={styles.batchReverted}>Reverted</span>
                ) : (
                  <button
                    className={settings.button}
                    onClick={() => setConfirming({ batchId: batch.batchId, writes: batch.writes })}
                    disabled={revertMutation.isPending}
                  >
                    Revert
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardSection>

      {confirming && (
        <ConfirmModal
          title="Revert these writes?"
          // Word for word the shape the collection revert uses, because the
          // caveat is the same one: putting a field back while the rule stays
          // armed means the next run writes it again.
          message={
            `${confirming.writes.toLocaleString()} field${confirming.writes === 1 ? "" : "s"} will go back to the ` +
            `values they held before this run, along with their original locked state. ` +
            `This changes Plex now, but not the rule — the next run writes the same values again from the same ` +
            `templates, so fix the rule if you don't want this back.`
          }
          confirmLabel={revertMutation.isPending ? "Reverting…" : "Revert"}
          danger
          onCancel={() => setConfirming(null)}
          onConfirm={handleRevert}
        />
      )}
    </div>
  );
}
