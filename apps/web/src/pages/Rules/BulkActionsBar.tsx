import shared from "../Collections.module.css";
import styles from "./Rules.module.css";

interface BulkActionsBarProps {
  count: number;
  onEnable: () => void;
  onDisable: () => void;
  onTest: () => void;
  onRun: () => void;
  onDelete: () => void;
  onCancel: () => void;
  updatePending: boolean;
  testPending: boolean;
  runPending: boolean;
}

export default function BulkActionsBar({
  count,
  onEnable,
  onDisable,
  onTest,
  onRun,
  onDelete,
  onCancel,
  updatePending,
  testPending,
  runPending,
}: BulkActionsBarProps) {
  return (
    <div className={styles.bulkBar}>
      <span>
        {count} rule{count !== 1 ? "s" : ""} selected
      </span>
      <button
        className={`${shared.buttonSecondary} ${shared.buttonSmall}`}
        onClick={onEnable}
        disabled={updatePending}
      >
        Enable
      </button>
      <button
        className={`${shared.buttonSecondary} ${shared.buttonSmall}`}
        onClick={onDisable}
        disabled={updatePending}
      >
        Disable
      </button>
      <button
        className={`${shared.buttonSecondary} ${shared.buttonSmall}`}
        onClick={onTest}
        disabled={testPending || runPending}
      >
        Test
      </button>
      <button
        className={`${shared.button} ${shared.buttonSmall}`}
        onClick={onRun}
        disabled={testPending || runPending}
      >
        Run
      </button>
      <button className={`${shared.buttonDanger} ${shared.buttonSmall}`} onClick={onDelete}>
        Delete
      </button>
      <span className={styles.bulkSpacer} />
      <button className={`${shared.buttonSecondary} ${shared.buttonSmall}`} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
