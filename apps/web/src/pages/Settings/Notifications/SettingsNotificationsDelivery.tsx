import { useEffect, useMemo, useState } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import UnsavedBanner from "#components/UnsavedBanner";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import { FormSkeleton } from "#components/Skeleton";
import CardSection from "#components/CardSection";
import { describeTimeRange } from "#pages/Jobs/Schedule/timeRange";
import styles from "#pages/Settings/Settings.module.css";
import { failedChecksSuffix } from "./failureWindow";

/**
 * The settings that apply to every channel rather than to one of them.
 *
 * They live on their own tab because the per-service forms are each about one
 * destination, and "don't send anything between midnight and seven" is not a
 * fact about Discord.
 */

interface QuietForm {
  enabled: boolean;
  from: string;
  to: string;
  allowUrgent: boolean;
}

const DEFAULT_QUIET: QuietForm = { enabled: false, from: "23:00", to: "07:00", allowUrgent: true };

export default function SettingsNotificationsDelivery() {
  const [quiet, setQuiet] = useState<QuietForm>(DEFAULT_QUIET);
  const [threshold, setThreshold] = useState(1);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const utils = trpc.useUtils();

  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const effectiveQuery = trpc.config.effectiveTimezone.useQuery();
  const saveConfigMutation = trpc.config.save.useMutation();
  const jobsQuery = trpc.jobs.list.useQuery(undefined, { refetchOnWindowFocus: false });
  const healthSchedule = jobsQuery.data?.find((j) => j.id === "healthcheck")?.schedule;

  useEffect(() => {
    if (!configQuery.data) return;
    setQuiet({ ...DEFAULT_QUIET, ...configQuery.data.notifications_quiet_hours });
    setThreshold(configQuery.data.health_failure_threshold ?? 1);
  }, [configQuery.data]);

  const isDirty = useMemo(() => {
    const data = configQuery.data;
    if (!data) return false;
    const savedQuiet = { ...DEFAULT_QUIET, ...data.notifications_quiet_hours };
    return JSON.stringify(quiet) !== JSON.stringify(savedQuiet) || threshold !== (data.health_failure_threshold ?? 1);
  }, [quiet, threshold, configQuery.data]);

  useUnsavedChanges(isDirty);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveConfigMutation.mutateAsync({
        notifications_quiet_hours: quiet,
        health_failure_threshold: threshold,
      });
      await utils.config.get.invalidate();
      addToast("Delivery settings saved", "success");
    } catch (err) {
      addToast(`Failed to save: ${(err as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  if (configQuery.isLoading) return <FormSkeleton rows={3} />;

  const zone = effectiveQuery.data?.timezone;

  return (
    <div className={styles.form}>
      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Quiet hours">
        <p className={styles.hint}>Holds back pushes; the activity feed still records everything.</p>

        <label className={styles.field}>
          <span className={styles.label}>
            <input
              type="checkbox"
              checked={quiet.enabled}
              onChange={(e) => setQuiet({ ...quiet, enabled: e.target.checked })}
            />{" "}
            Stay quiet overnight
          </span>
        </label>

        {quiet.enabled && (
          <>
            <div className={styles.field}>
              <span className={styles.label}>Between</span>
              <div className={styles.inlineFields}>
                <input
                  type="time"
                  className={styles.input}
                  value={quiet.from}
                  onChange={(e) => setQuiet({ ...quiet, from: e.target.value })}
                  aria-label="Quiet hours start"
                />
                <input
                  type="time"
                  className={styles.input}
                  value={quiet.to}
                  onChange={(e) => setQuiet({ ...quiet, to: e.target.value })}
                  aria-label="Quiet hours end"
                />
              </div>
              <span className={styles.hint}>
                {describeTimeRange(quiet.from, quiet.to)}
                {zone && ` (${zone})`}
              </span>
            </div>

            <label className={styles.field}>
              <span className={styles.label}>
                <input
                  type="checkbox"
                  checked={quiet.allowUrgent}
                  onChange={(e) => setQuiet({ ...quiet, allowUrgent: e.target.checked })}
                />{" "}
                Let &ldquo;Plex Unreachable&rdquo; through anyway
              </span>
              <span className={styles.hint}>Outages still notify during quiet hours.</span>
            </label>
          </>
        )}
      </CardSection>

      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Flapping services">
        <label className={styles.field}>
          <span className={styles.label}>Announce a failure after</span>
          <span className={styles.suffixRow}>
            <input
              type="number"
              className={styles.input}
              min={1}
              max={20}
              value={threshold}
              onChange={(e) => setThreshold(Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1)))}
            />
            <span className={styles.suffix}>{failedChecksSuffix(threshold, healthSchedule)}</span>
          </span>
          <span className={styles.hint}>Raise to ignore one-off blips.</span>
        </label>

        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={handleSave} disabled={saving || !isDirty}>
            {saving ? "Saving…" : "Save"}
          </button>
          <UnsavedBanner visible={isDirty} />
        </div>
      </CardSection>
    </div>
  );
}
