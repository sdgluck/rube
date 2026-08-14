import styles from "#pages/Stats/Stats.module.css";
import { PERIODS, type PeriodDays } from "./usePeriod";

/** Shared 7d / 30d / 90d / All control for the playback-history panels. */
export function PeriodSelector({ value, onChange }: { value: PeriodDays; onChange: (days: PeriodDays) => void }) {
  return (
    <div className={styles.segmented} role="tablist" aria-label="Period">
      {PERIODS.map((p) => (
        <button
          key={p.days}
          type="button"
          role="tab"
          aria-selected={value === p.days}
          className={`${styles.segmentedBtn} ${value === p.days ? styles.segmentedBtnActive : ""}`}
          onClick={() => onChange(p.days)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
