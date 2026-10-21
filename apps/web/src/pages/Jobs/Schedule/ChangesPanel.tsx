import { Undo2 } from "lucide-react";
import {
  describeSchedule,
  diffSchedulePlans,
  diffScheduleSettings,
  parseSchedule,
  type JobPlanEntry,
  type ScheduleJob,
  type SchedulePlan,
  type ScheduleSettings,
} from "@rube/contracts";
import styles from "./Schedule.module.css";

function describe(entry: JobPlanEntry): string {
  return `${describeSchedule(parseSchedule(entry.schedule))}${entry.enabled ? "" : " (off)"}`;
}

const SETTING_LABEL: Record<keyof ScheduleSettings, string> = {
  timezone: "Timezone",
  maintenanceWindow: "Maintenance window",
  deferWhileStreaming: "Wait while streaming",
};

function describeSetting(key: keyof ScheduleSettings, plan: SchedulePlan): string {
  const s = plan.settings;
  if (key === "timezone") return s.timezone || "server's own";
  if (key === "maintenanceWindow") {
    return s.maintenanceWindow.enabled ? `${s.maintenanceWindow.from}–${s.maintenanceWindow.to}` : "off";
  }
  return s.deferWhileStreaming.enabled ? `up to ${s.deferWhileStreaming.maxWaitMinutes} min` : "off";
}

/** What Save would write, each line with its own way back. */
export default function ChangesPanel({
  jobs,
  base,
  current,
  onRevert,
  onRevertSetting,
}: {
  jobs: ScheduleJob[];
  base: SchedulePlan;
  current: SchedulePlan;
  onRevert: (jobId: string) => void;
  onRevertSetting: (key: keyof ScheduleSettings) => void;
}) {
  const names = new Map(jobs.map((j) => [j.id, j.name]));
  const changes = diffSchedulePlans(base, current);
  const settings = diffScheduleSettings(base, current);
  if (changes.length === 0 && settings.length === 0) {
    return <p className={styles.muted}>No unsaved changes.</p>;
  }
  return (
    <ul className={styles.changes}>
      {settings.map((key) => (
        <li key={key} className={styles.change}>
          <span className={styles.changeName}>{SETTING_LABEL[key]}</span>
          <span className={styles.changeDiff}>
            <s>{describeSetting(key, base)}</s> → {describeSetting(key, current)}
          </span>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => onRevertSetting(key)}
            aria-label={`Revert ${SETTING_LABEL[key]}`}
            title="Revert"
          >
            <Undo2 size="1.4rem" />
          </button>
        </li>
      ))}
      {changes.map(({ jobId, from, to }) => (
        <li key={jobId} className={styles.change}>
          <span className={styles.changeName}>{names.get(jobId) ?? jobId}</span>
          <span className={styles.changeDiff}>
            <s>{describe(from)}</s> → {describe(to)}
          </span>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => onRevert(jobId)}
            aria-label={`Revert ${names.get(jobId) ?? jobId}`}
            title="Revert"
          >
            <Undo2 size="1.4rem" />
          </button>
        </li>
      ))}
    </ul>
  );
}
