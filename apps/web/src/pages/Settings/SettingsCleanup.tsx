import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import shared from "#/styles/shared.module.css";
import SettingsPageHeader from "./SettingsPageHeader";
import styles from "./SettingsCleanup.module.css";

const DEFAULT_MAX_DELETES = 50;

/**
 * The master switch for rule-driven cleanup.
 *
 * This exists as its own pane, rather than a checkbox tucked into Rules,
 * because its whole purpose is to be findable in a hurry. Somebody who has
 * just realised a rule is removing the wrong things needs one switch they can
 * describe over the phone — not N rules to hunt down and disable individually.
 *
 * Off by default, and every destructive cleanup action checks it at the moment
 * it would act, so flipping it here stops a run that is already in flight at
 * its next item.
 */
export default function SettingsCleanup() {
  const [enabled, setEnabled] = useState(false);
  const [maxDeletes, setMaxDeletes] = useState(DEFAULT_MAX_DELETES);
  const [saving, setSaving] = useState(false);

  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const saveMutation = trpc.config.save.useMutation();
  const queueQuery = trpc.cleanup.queue.useQuery(undefined, { refetchOnWindowFocus: false });

  useEffect(() => {
    if (configQuery.data) {
      setEnabled(configQuery.data.cleanup_enabled ?? false);
      setMaxDeletes(configQuery.data.cleanup_max_deletes_per_day ?? DEFAULT_MAX_DELETES);
    }
  }, [configQuery.data]);

  const isDirty = useMemo(() => {
    if (!configQuery.data) return false;
    return (
      enabled !== (configQuery.data.cleanup_enabled ?? false) ||
      maxDeletes !== (configQuery.data.cleanup_max_deletes_per_day ?? DEFAULT_MAX_DELETES)
    );
  }, [enabled, maxDeletes, configQuery.data]);

  useUnsavedChanges(isDirty);

  const queued = queueQuery.data?.length ?? 0;
  const dueNow = (queueQuery.data ?? []).filter(
    (r) => r.runsRemaining === 0 && !(r.heldUntil != null && r.heldUntil > Date.now()),
  ).length;

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveMutation.mutateAsync({
        cleanup_enabled: enabled,
        cleanup_max_deletes_per_day: maxDeletes,
      });
      addToast("Cleanup settings saved", "success");
      await utils.config.get.invalidate();
    } catch {
      addToast("Failed to save cleanup settings", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingsPageHeader title="Cleanup" />

      <p className={styles.intro}>
        Rules whose outcome is <strong>Cleanup</strong> can label, unmonitor, or delete the items they match. Nothing
        destructive happens unless this switch is on — it is checked every time a rule is about to act, not when the
        rule is saved, so turning it off stops work already in progress.
      </p>

      <div className={styles.field}>
        <label className={styles.switchRow}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>
            <span className={styles.switchLabel}>Allow cleanup rules to remove things</span>
            <span className={styles.switchHint}>
              Off means unmonitor and delete are refused for every rule, with the reason in the run log. Labelling and
              queue-only rules keep working — they don't remove anything.
            </span>
          </span>
        </label>
      </div>

      {enabled && (
        <div className={styles.armed} role="status">
          Cleanup is armed. Rules that are past their preview-only setting will remove things on their next scheduled
          run.
        </div>
      )}

      <div className={styles.field}>
        <label htmlFor="cleanup-max">Most items to remove per day, across all rules</label>
        <input
          id="cleanup-max"
          type="number"
          min={1}
          className={shared.input}
          value={maxDeletes}
          onChange={(e) => setMaxDeletes(Math.max(1, parseInt(e.target.value, 10) || 1))}
        />
        <span className={styles.hint}>
          A backstop over and above each rule's own limit. Per-rule caps don't compose — five rules each staying under
          thirty can still empty a library in one night. Counted over a rolling 24 hours from what was actually removed,
          so scheduled runs and rules you run by hand draw on the same allowance.
        </span>
      </div>

      <p className={styles.queueLine}>
        {queued === 0 ? (
          <>Nothing is queued for cleanup right now.</>
        ) : (
          <>
            <Link to="/cleanup">
              {queued} item{queued === 1 ? "" : "s"} queued
            </Link>
            {dueNow > 0 && <>, {dueNow} of them due on the next run</>}.
          </>
        )}
      </p>

      <div className={styles.actions}>
        <button className={shared.button} onClick={handleSave} disabled={!isDirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </>
  );
}
