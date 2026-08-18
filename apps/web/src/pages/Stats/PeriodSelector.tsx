import styles from "#pages/Stats/Stats.module.css";
import { PERIODS, type PeriodDays } from "./usePeriod";

/**
 * Shared 7d / 30d / 90d / All control for the playback-history panels.
 *
 * `omitAll` drops the all-time option for panels that draw a *window* rather
 * than a total: the daily chart has one column per day, and "all time" is not a
 * number of columns. Better to not offer it than to silently reinterpret it.
 */
export function PeriodSelector({
  value,
  onChange,
  omitAll = false,
}: {
  value: PeriodDays;
  onChange: (days: PeriodDays) => void;
  omitAll?: boolean;
}) {
  const periods = omitAll ? PERIODS.filter((p) => p.days !== 0) : PERIODS;
  return (
    <div className={styles.segmented} role="tablist" aria-label="Period">
      {periods.map((p) => (
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
