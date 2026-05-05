import { trpc } from "../../../../trpc";
import ToggleSwitch from "../../../../ToggleSwitch";
import styles from "../../../Jobs.module.css";

export default function EnabledRow({ jobId, enabled }: { jobId: string; enabled: boolean }) {
  const utils = trpc.useUtils();
  const updateMutation = trpc.jobs.update.useMutation({
    onSuccess: () => utils.jobs.list.invalidate(),
  });

  return (
    <tr>
      <td>Enabled</td>
      <td>
        <ToggleSwitch
          size="sm"
          checked={enabled}
          onChange={(checked) => updateMutation.mutate({ jobId, enabled: checked })}
        />
      </td>
      <td className={styles.configSummary}>{enabled ? "Yes" : "No"}</td>
    </tr>
  );
}
