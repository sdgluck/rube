import { useMemo } from "react";
import type { ScheduleSettings } from "@rube/contracts";
import { trpc } from "#/trpc";
import { timezoneOptions } from "#lib/timezones";
import controls from "#/styles/controls.module.css";
import styles from "./Schedule.module.css";
import { describeTimeRange } from "./timeRange";

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
          className={`${controls.select} ${controls.selectSm}`}
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
        <span className={styles.settingsHint}>Unset follows the container's clock.</span>
      </label>

      {/* The two holds share one ceiling, so they are one group: "Wait at most"
          caps both, and has nothing to cap while both are off. */}
      <fieldset className={styles.holdGroup}>
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
              className={`${controls.input} ${controls.inputSm}`}
              value={window.from}
              aria-label="Window start"
              onChange={(e) => onChange({ maintenanceWindow: { ...window, from: e.target.value } })}
            />
            <span>to</span>
            <input
              type="time"
              className={`${controls.input} ${controls.inputSm}`}
              value={window.to}
              aria-label="Window end"
              onChange={(e) => onChange({ maintenanceWindow: { ...window, to: e.target.value } })}
            />
            <span className={styles.settingsHint}>{describeTimeRange(window.from, window.to)}</span>
          </div>
        )}

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
            className={`${`${controls.input} ${controls.inputSm}`} ${styles.minuteInput}`}
            disabled={!window.enabled && !defer.enabled}
            value={defer.maxWaitMinutes}
            onChange={(e) =>
              onChange({ deferWhileStreaming: { ...defer, maxWaitMinutes: Math.round(Number(e.target.value) || 0) } })
            }
          />
          <span>minutes</span>
        </label>
        <span className={styles.settingsHint}>
          Doesn't apply to <strong>Run now</strong>.
        </span>
      </fieldset>

      {waiting.length > 0 && <p className={styles.waiting}>Waiting right now: {waiting.join(", ")}.</p>}
    </div>
  );
}
