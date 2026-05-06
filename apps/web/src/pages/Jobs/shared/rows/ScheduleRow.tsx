import { useState, useCallback } from "react";
import { trpc } from "#/trpc";
import { describeCron } from "#/utils";
import styles from "#pages/Jobs/Jobs.module.css";

export default function ScheduleRow({ jobId, schedule }: { jobId: string; schedule: string }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const updateMutation = trpc.jobs.update.useMutation({
    onSuccess: () => utils.jobs.list.invalidate(),
  });

  const handleBlur = useCallback(() => {
    if (editing === undefined) return;
    updateMutation.mutate(
      { jobId, schedule: editing },
      {
        onError: (err) => setError(err.message),
        onSuccess: () => {
          setEditing(undefined);
          setError(undefined);
        },
      },
    );
  }, [editing, jobId, updateMutation]);

  const value = editing ?? schedule;
  const help = error ?? describeCron(value) ?? "";

  return (
    <tr>
      <td className={styles.fieldLabel}>Schedule</td>
      <td>
        <input
          className={styles.cronInput}
          value={value}
          placeholder="manual only"
          onChange={(e) => {
            setEditing(e.target.value);
            setError(undefined);
          }}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        {help && <div className={error ? styles.fieldHelpError : styles.fieldHelp}>{help}</div>}
      </td>
    </tr>
  );
}
