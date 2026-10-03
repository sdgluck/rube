import { Link } from "react-router-dom";
import CronPreview from "#components/CronPreview";
import styles from "#pages/Jobs/Jobs.module.css";

/**
 * Controlled, and saved with the rest of the settings. It used to save on blur
 * on its own while the fields beside it waited for Save — two save models in
 * one card, and a half-typed cron could be committed by clicking away.
 */
export default function ScheduleRow({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  error?: string;
}) {
  return (
    <tr>
      <td className={styles.fieldLabel}>Schedule</td>
      <td>
        <input
          className={styles.cronInput}
          value={value}
          placeholder="manual only"
          onChange={(e) => onChange(e.target.value)}
        />
        {error ? <div className={styles.fieldHelpError}>{error}</div> : <CronPreview expr={value} />}
        {/* The schedule in context: what runs around it, and whether it fits. */}
        <Link to="/jobs/schedule" className={styles.fieldHelp}>
          See it on the schedule timeline
        </Link>
      </td>
    </tr>
  );
}
