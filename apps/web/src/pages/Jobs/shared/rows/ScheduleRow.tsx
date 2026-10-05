import { Link } from "react-router-dom";
import CronPreview from "#components/CronPreview";
import SchedulePicker from "#components/SchedulePicker";
import styles from "#pages/Jobs/Jobs.module.css";

/**
 * Controlled, and saved with the rest of the settings. It used to save on blur
 * on its own while the fields beside it waited for Save — two save models in
 * one card, and a half-typed cron could be committed by clicking away.
 *
 * The same picker as the schedule page and the rule wizard. This row was the
 * last bare cron box, which made "run it on the 1st" a syntax question here and
 * a few clicks everywhere else.
 */
export default function ScheduleRow({
  value,
  onChange,
  error,
  allowSeconds,
}: {
  value: string;
  onChange: (next: string) => void;
  error?: string;
  allowSeconds?: boolean;
}) {
  return (
    <tr>
      <td className={styles.fieldLabel}>Schedule</td>
      <td>
        <div className={styles.schedulePicker}>
          <SchedulePicker value={value} onChange={onChange} allowSeconds={allowSeconds} />
        </div>
        {error ? <div className={styles.fieldHelpError}>{error}</div> : <CronPreview expr={value} />}
        {/* The schedule in context: what runs around it, and whether it fits. */}
        <Link to="/jobs/schedule" className={styles.fieldHelp}>
          See it on the schedule timeline
        </Link>
      </td>
    </tr>
  );
}
