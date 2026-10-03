import { useMemo } from "react";
import type { ScheduleSettings } from "@tinkerbell/contracts";
import { trpc } from "#/trpc";
import { timezoneOptions } from "#lib/timezones";
import controls from "#/styles/controls.module.css";
import styles from "./Schedule.module.css";

/**
 * Timezone, the maintenance window and defer-while-streaming — what used to be
 * Settings → Schedules. Here because each one changes what the timeline means:
 * the window is drawn on it, and the timezone is the clock it is drawn in.
 * Edits go into the same draft as the jobs, so a window change and the moves it
 * prompts are one save and one entry in History.
 */
export default function SettingsCard({
  settings,
  serverTimezone,
  onChange,
}: {
  settings: ScheduleSettings;
  serverTimezone: string;
  onChange: (patch: Partial<ScheduleSettings>) => void;
}) {
  const zones = useMemo(timezoneOptions, []);
  const deferredQuery = trpc.jobs.deferred.useQuery(undefined, { refetchInterval: 15_000 });
  const { maintenanceWindow: window, deferWhileStreaming: defer } = settings;
  // Jobs and rules are held by different machinery but answer one question for
  // whoever is reading this — "what is waiting?" — so they are listed as one.
  const waiting = [
    ...(deferredQuery.data?.jobs ?? []).map((w) => w.jobName),
    ...(deferredQuery.data?.rules ?? []).map((w) => w.ruleName),
  ];

  return (
    <div className={styles.settings}>
      <label className={styles.settingsField}>
        <span className={styles.editorLabel}>Timezone</span>
        <select
          className={controls.selectSm}
          value={settings.timezone}
          onChange={(e) => onChange({ timezone: e.target.value })}
        >
          <option value="">Server's own ({serverTimezone})</option>
          {settings.timezone && !zones.includes(settings.timezone) && (
            <option value={settings.timezone}>{settings.timezone}</option>
          )}
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
        <span className={styles.settingsHint}>
          Every schedule here is read in this zone. Leaving it unset follows the container's clock, which is easy to get
          wrong.
        </span>
      </label>

      <label className={styles.settingsCheck}>
        <input
          type="checkbox"
          className={controls.toggleSm}
          checked={window.enabled}
          onChange={(e) => onChange({ maintenanceWindow: { ...window, enabled: e.target.checked } })}
        />
        Only start heavy jobs during a window
      </label>
      {window.enabled && (
        <div className={styles.settingsInline}>
          <input
            type="time"
            className={controls.inputSm}
            value={window.from}
            aria-label="Window start"
            onChange={(e) => onChange({ maintenanceWindow: { ...window, from: e.target.value } })}
          />
          <span>to</span>
          <input
            type="time"
            className={controls.inputSm}
            value={window.to}
            aria-label="Window end"
            onChange={(e) => onChange({ maintenanceWindow: { ...window, to: e.target.value } })}
          />
        </div>
      )}
      <span className={styles.settingsHint}>
        Shaded on the timeline. A heavy job due outside it waits for it — but only for as long as the limit below, then
        runs anyway. An end before the start spans midnight.
      </span>

      <label className={styles.settingsCheck}>
        <input
          type="checkbox"
          className={controls.toggleSm}
          checked={defer.enabled}
          onChange={(e) => onChange({ deferWhileStreaming: { ...defer, enabled: e.target.checked } })}
        />
        Wait while someone is watching
      </label>
      {defer.enabled && (
        <label className={styles.settingsCheck}>
          <input
            type="checkbox"
            className={controls.checkbox}
            checked={defer.transcodesOnly}
            onChange={(e) => onChange({ deferWhileStreaming: { ...defer, transcodesOnly: e.target.checked } })}
          />
          Only for transcodes
        </label>
      )}
      <label className={styles.settingsInline}>
        <span>Wait at most</span>
        <input
          type="number"
          min={1}
          max={1440}
          className={`${controls.inputSm} ${styles.minuteInput}`}
          value={defer.maxWaitMinutes}
          onChange={(e) =>
            onChange({ deferWhileStreaming: { ...defer, maxWaitMinutes: Math.round(Number(e.target.value) || 0) } })
          }
        />
        <span>minutes</span>
      </label>
      <span className={styles.settingsHint}>
        The ceiling for both: a household that streams every evening would otherwise push the nightly jobs into never
        running. Nothing here applies to <strong>Run now</strong>.
      </span>

      {waiting.length > 0 && (
        <p className={styles.waiting}>
          Waiting right now: {waiting.join(", ")}. Each starts as soon as the server is quiet, or when its wait runs
          out.
        </p>
      )}
    </div>
  );
}
