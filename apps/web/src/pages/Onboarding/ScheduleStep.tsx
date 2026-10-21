import { useState } from "react";
import { Link } from "react-router-dom";
import { describeSchedule, parseSchedule, RECOMMENDED_SCHEDULE_SETTINGS } from "@rube/contracts";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import { timezoneOptions } from "#lib/timezones";
import controls from "#/styles/controls.module.css";
import styles from "./Onboarding.module.css";

// Read from the constant `applyScheduleDefaults` writes — shown, not guessed.
const { maintenanceWindow, deferWhileStreaming } = RECOMMENDED_SCHEDULE_SETTINGS;
const RECOMMENDED = {
  window: `${maintenanceWindow.from} to ${maintenanceWindow.to}`,
  defer: `hold off while anyone is streaming, for up to ${deferWhileStreaming.maxWaitMinutes / 60} hours`,
};

export default function ScheduleStep({ cfg }: { cfg: Record<string, unknown> }) {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const stored = (cfg.global_timezone as string) ?? "";
  // The browser's zone is preselected unless one is already stored: it is
  // right for nearly everyone, and an unset zone follows the container clock.
  const [timezone, setTimezone] = useState(stored || detected);
  const [applying, setApplying] = useState(false);

  const applyDefaults = trpc.onboarding.applyScheduleDefaults.useMutation();
  const jobsQuery = trpc.jobs.list.useQuery();
  const scheduled = (jobsQuery.data ?? []).filter((j) => j.schedule && j.enabled);

  async function apply() {
    setApplying(true);
    try {
      await applyDefaults.mutateAsync({ timezone });
      await utils.config.get.invalidate();
      await utils.onboarding.status.invalidate();
      utils.jobs.list.invalidate();
      addToast("Recommended schedule applied", "success");
    } catch (err) {
      addToast(`Couldn't apply: ${(err as Error).message}`, "error");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className={styles.stepBody}>
      <h2 className={styles.stepTitle}>When should Rube work?</h2>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Timezone</span>
        <select className={controls.select} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {!timezoneOptions().includes(timezone) && <option value={timezone}>{timezone}</option>}
          {timezoneOptions().map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <span className={styles.fieldHint}>Every schedule is read in this zone.</span>
      </label>
      {detected && timezone !== detected && (
        <div>
          <button
            type="button"
            className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}
            onClick={() => setTimezone(detected)}
          >
            Use detected ({detected})
          </button>
        </div>
      )}

      <div className={styles.recommend}>
        <h3 className={styles.groupHeading}>Recommended</h3>
        <ul className={styles.recommendList}>
          <li>Timezone set to {timezone}</li>
          <li>Heavy jobs confined to {RECOMMENDED.window}</li>
          <li>And they {RECOMMENDED.defer}</li>
          <li>Nightly jobs moved into that window in dependency order, unless you&apos;ve moved them</li>
        </ul>
        <button
          type="button"
          className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`}
          onClick={apply}
          disabled={applying}
        >
          {applying ? "Applying…" : "Use recommended"}
        </button>
        <p className={styles.fieldHint}>
          All of it is editable later in <Link to="/jobs/schedule">Jobs → Schedule</Link>.
        </p>
      </div>

      {scheduled.length > 0 && (
        <>
          <h3 className={styles.groupHeading}>What runs, and when</h3>
          <ul className={styles.jobList}>
            {scheduled.map((job) => (
              <li key={job.id} className={styles.jobRow}>
                <span>{job.name}</span>
                <code className={styles.cron}>{describeSchedule(parseSchedule(job.schedule))}</code>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
