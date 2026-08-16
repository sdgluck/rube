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

interface DeferForm {
  enabled: boolean;
  maxWaitMinutes: number;
  transcodesOnly: boolean;
}

interface WindowForm {
  enabled: boolean;
  from: string;
  to: string;
}

const DEFAULT_DEFER: DeferForm = { enabled: false, maxWaitMinutes: 120, transcodesOnly: false };
const DEFAULT_WINDOW: WindowForm = { enabled: false, from: "01:00", to: "06:00" };

export default function SettingsSchedules() {
  const [timezone, setTimezone] = useState("");
  const [defer, setDefer] = useState<DeferForm>(DEFAULT_DEFER);
  const [window, setWindow] = useState<WindowForm>(DEFAULT_WINDOW);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const utils = trpc.useUtils();

  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const effectiveQuery = trpc.config.effectiveTimezone.useQuery();
  const saveConfigMutation = trpc.config.save.useMutation();
  const deferredQuery = trpc.jobs.deferred.useQuery(undefined, { refetchInterval: 15_000 });

  useEffect(() => {
    if (!configQuery.data) return;
    setTimezone(configQuery.data.global_timezone || "");
    setDefer({ ...DEFAULT_DEFER, ...configQuery.data.jobs_defer_while_streaming });
    setWindow({ ...DEFAULT_WINDOW, ...configQuery.data.jobs_maintenance_window });
  }, [configQuery.data]);

  const isDirty = useMemo(() => {
    const data = configQuery.data;
    if (!data) return false;
    const savedDefer = { ...DEFAULT_DEFER, ...data.jobs_defer_while_streaming };
    const savedWindow = { ...DEFAULT_WINDOW, ...data.jobs_maintenance_window };
    return (
      timezone !== (data.global_timezone || "") ||
      JSON.stringify(defer) !== JSON.stringify(savedDefer) ||
      JSON.stringify(window) !== JSON.stringify(savedWindow)
    );
  }, [timezone, defer, window, configQuery.data]);

  useUnsavedChanges(isDirty);

  const zones = useMemo(timezoneOptions, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveConfigMutation.mutateAsync({
        global_timezone: timezone,
        jobs_defer_while_streaming: defer,
        jobs_maintenance_window: window,
      });
      await utils.config.effectiveTimezone.invalidate();
      await utils.config.get.invalidate();
      addToast("Schedules saved", "success");
    } catch (err) {
      addToast(`Failed to save: ${(err as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  if (configQuery.isLoading) return <FormSkeleton rows={3} />;
  if (configQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load settings</div>;

  const effective = effectiveQuery.data;
  const waiting = deferredQuery.data ?? [];

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
      </CardSection>

      {/* Both settings hold the same set of heavy jobs back, so they live in
          one card — a user reasoning about "why hasn't this run" needs to see
          both answers at once. */}
      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Staying out of the way">
        <p className={styles.hint}>
          Poster rendering, overlay burn-in and preroll transcodes compete for the same CPU and disk that serve a stream
          — and they are scheduled for the hours somebody is most likely to be watching. These hold that work back.
          Neither applies to a job you start yourself: pressing <strong>Run now</strong> always runs now.
        </p>

        <label className={styles.field}>
          <span className={styles.label}>
            <input
              type="checkbox"
              checked={defer.enabled}
              onChange={(e) => setDefer({ ...defer, enabled: e.target.checked })}
            />{" "}
            Wait while someone is watching
          </span>
        </label>
        {defer.enabled && (
          <>
            <label className={styles.field}>
              <span className={styles.label}>
                <input
                  type="checkbox"
                  checked={defer.transcodesOnly}
                  onChange={(e) => setDefer({ ...defer, transcodesOnly: e.target.checked })}
                />{" "}
                Only wait for transcodes
              </span>
              <span className={styles.hint}>
                A direct play is mostly disk and network; a transcode is the CPU these jobs want. On a server that
                rarely transcodes, this is the difference between waiting sometimes and waiting every evening.
              </span>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Give up waiting after</span>
              <input
                type="number"
                className={styles.input}
                min={1}
                max={1440}
                value={defer.maxWaitMinutes}
                onChange={(e) => setDefer({ ...defer, maxWaitMinutes: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              />
              <span className={styles.hint}>
                Minutes. There has to be a ceiling — a household that streams every evening would otherwise push the
                nightly jobs into never running at all. When it expires the job runs anyway and says so in the log.
              </span>
            </label>
          </>
        )}

        <label className={styles.field}>
          <span className={styles.label}>
            <input
              type="checkbox"
              checked={window.enabled}
              onChange={(e) => setWindow({ ...window, enabled: e.target.checked })}
            />{" "}
            Only start heavy jobs during a window
          </span>
        </label>
        {window.enabled && (
          <>
            <div className={styles.field}>
              <span className={styles.label}>Between</span>
              <div className={styles.inlineFields}>
                <input
                  type="time"
                  className={styles.input}
                  value={window.from}
                  onChange={(e) => setWindow({ ...window, from: e.target.value })}
                  aria-label="Window start"
                />
                <input
                  type="time"
                  className={styles.input}
                  value={window.to}
                  onChange={(e) => setWindow({ ...window, to: e.target.value })}
                  aria-label="Window end"
                />
              </div>
              <span className={styles.hint}>
                In the timezone above. An end before the start spans midnight, which is usually what an overnight window
                means — 22:00 to 06:00 rather than 01:00 to 06:00.
              </span>
            </div>
          </>
        )}

        {waiting.length > 0 && (
          <p className={styles.hint}>
            Waiting right now: {waiting.map((w) => w.jobName).join(", ")}. Each starts as soon as the server is quiet,
            or when its wait runs out.
          </p>
        )}

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
