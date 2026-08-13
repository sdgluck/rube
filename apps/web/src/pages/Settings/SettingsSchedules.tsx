import { useState, useEffect, useMemo } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import UnsavedBanner from "#components/UnsavedBanner";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import { FormSkeleton } from "#components/Skeleton";
import SettingsPageHeader from "./SettingsPageHeader";
import styles from "./Settings.module.css";
import CardSection from "#components/CardSection";

/**
 * The zone list comes from the browser's own ICU data when available, so it
 * always matches what Node will accept. The fallback covers the handful of
 * older engines without `supportedValuesOf`.
 */
function timezoneOptions(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  if (typeof supported === "function") {
    try {
      return supported("timeZone");
    } catch {
      // fall through
    }
  }
  return ["UTC", Intl.DateTimeFormat().resolvedOptions().timeZone].filter(Boolean);
}

export default function SettingsSchedules() {
  const [timezone, setTimezone] = useState("");
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const utils = trpc.useUtils();

  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const effectiveQuery = trpc.config.effectiveTimezone.useQuery();
  const saveConfigMutation = trpc.config.save.useMutation();

  useEffect(() => {
    if (configQuery.data) setTimezone(configQuery.data.global_timezone || "");
  }, [configQuery.data]);

  const isDirty = useMemo(() => {
    if (!configQuery.data) return false;
    return timezone !== (configQuery.data.global_timezone || "");
  }, [timezone, configQuery.data]);

  useUnsavedChanges(isDirty);

  const zones = useMemo(timezoneOptions, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveConfigMutation.mutateAsync({ global_timezone: timezone });
      await utils.config.effectiveTimezone.invalidate();
      await utils.config.get.invalidate();
      addToast("Timezone saved — schedules rebuilt", "success");
    } catch (err) {
      addToast(`Failed to save timezone: ${(err as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  if (configQuery.isLoading) return <FormSkeleton rows={3} />;
  if (configQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load settings</div>;

  const effective = effectiveQuery.data;

  return (
    <div className={styles.form}>
      <SettingsPageHeader title="Schedules" />
      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Timezone">
        <label className={styles.field}>
          <span className={styles.label}>Schedule timezone</span>
          <select className={styles.input} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            <option value="">Use the server's timezone</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <p className={styles.hint}>
          Every job schedule is evaluated in this zone, so &ldquo;3am&rdquo; means 3am here. Leaving it unset follows
          the container&rsquo;s clock, which is easy to get wrong and shifts twice a year with daylight saving.
          {effective && (
            <>
              {" "}
              Currently using <strong>{effective.timezone}</strong>
              {effective.explicit ? "." : " (from the server, not set here)."}
            </>
          )}
        </p>
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
