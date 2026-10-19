import controls from "#/styles/controls.module.css";
import styles from "./MonthDaySelect.module.css";
import { daysInMonth, formatMonthDay, MONTH_NAMES, parseMonthDay } from "#lib/month-day";

/** One end of a yearly window — a rule's, or a season's — as a day and a month rather than `MM-DD`. */
export default function MonthDaySelect({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const { month, day } = parseMonthDay(value);
  return (
    <span className={styles.monthDay} role="group" aria-label={label}>
      <select
        className={`${controls.select} ${controls.selectSm}`}
        value={day}
        aria-label={`${label} day`}
        onChange={(e) => onChange(formatMonthDay({ month, day: Number(e.target.value) }))}
      >
        {Array.from({ length: daysInMonth(month) }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <select
        className={`${controls.select} ${controls.selectSm}`}
        value={month}
        aria-label={`${label} month`}
        onChange={(e) => onChange(formatMonthDay({ month: Number(e.target.value), day }))}
      >
        {MONTH_NAMES.map((name, i) => (
          <option key={name} value={i + 1}>
            {name}
          </option>
        ))}
      </select>
    </span>
  );
}
