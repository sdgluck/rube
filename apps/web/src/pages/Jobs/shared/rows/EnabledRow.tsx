import ToggleSwitch from "#components/ToggleSwitch";
import styles from "#pages/Jobs/Jobs.module.css";
import { useSetEnabled } from "../useSetEnabled";

export default function EnabledRow({ jobId, enabled }: { jobId: string; enabled: boolean }) {
  const { setEnabled } = useSetEnabled();
  return (
    <tr>
      <td className={styles.fieldLabel}>Enabled</td>
      <td>
        <ToggleSwitch size="sm" checked={enabled} onChange={(checked) => setEnabled(jobId, checked)} />
      </td>
    </tr>
  );
}
