import styles from "./BulkBar.module.css";

export type BulkAction = {
  label: string;
  onClick: () => void;
  /** "primary" for the affirmative verb, "danger" for anything destructive. */
  tone?: "primary" | "danger";
  disabled?: boolean;
  title?: string;
};

/**
 * The selection toolbar, identical on every list: what's selected on the left,
 * the verbs in the middle, and Clear on the right — always called Clear, so
 * "get me out of this mode" is the same word everywhere.
 */
export default function BulkBar({
  count,
  noun,
  actions,
  onClear,
  progress,
}: {
  count: number;
  /** Singular form; pluralised for the count ("rule" → "3 rules selected"). */
  noun: string;
  actions: BulkAction[];
  onClear: () => void;
  /** While set, the bar reports progress in place instead of offering actions. */
  progress?: { done: number; total: number; label?: string } | null;
}) {
  if (progress) {
    const pct = progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
    return (
      <div className={styles.bar}>
        <div className={styles.progressTrack} aria-hidden>
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        </div>
        <span className={styles.count}>
          {progress.label ?? "Working"} {progress.done}/{progress.total}…
        </span>
      </div>
    );
  }

  return (
    <div className={styles.bar}>
      <span className={styles.count}>
        {count} {noun}
        {count === 1 ? "" : "s"} selected
      </span>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className={
            action.tone === "danger" ? styles.btnDanger : action.tone === "primary" ? styles.btnPrimary : styles.btn
          }
          onClick={action.onClick}
          disabled={action.disabled}
          title={action.title}
        >
          {action.label}
        </button>
      ))}
      <span className={styles.spacer} />
      <button type="button" className={styles.btn} onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
