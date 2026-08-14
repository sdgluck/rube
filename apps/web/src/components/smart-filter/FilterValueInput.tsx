import { fieldDef, fieldKind } from "@tinkerbell/contracts";
import {
  formatCalendarDate,
  isTruthyBoolean,
  parseRelativeDate,
  resolveRelativeDate,
  toRelativeDate,
  type RelativeUnit,
} from "./format.ts";
import TagValueSelect, { type TagValueMode } from "./TagValueSelect.tsx";
import styles from "./FilterValueInput.module.css";

/**
 * The value half of a smart-filter clause, rendered to match the field's
 * type: a genre picker for tags, Yes/No for booleans, a relative-or-exact
 * date control for dates, minutes/hours for runtimes.
 *
 * Strictly a display layer — every control emits exactly the string Plex
 * expects (`"1"`, `"-30d"`, `"7200000"`), so nothing about what is saved or
 * sent to Plex changes.
 */
export default function FilterValueInput({
  field,
  value,
  sectionId,
  tagMode = "key",
  inputClassName,
  selectClassName,
  onChange,
}: {
  field: string;
  value: string;
  sectionId: string | null;
  tagMode?: TagValueMode;
  /** Editor-supplied class for text/number inputs. */
  inputClassName?: string;
  /** Editor-supplied class for selects. */
  selectClassName?: string;
  onChange: (value: string) => void;
}) {
  switch (fieldKind(field)) {
    case "tag":
      return (
        <TagValueSelect
          field={field}
          value={value}
          sectionId={sectionId}
          mode={tagMode}
          className={`${selectClassName ?? ""} ${styles.grow}`}
          onChange={onChange}
        />
      );
    case "boolean":
      return (
        <select
          className={`${selectClassName ?? ""} ${styles.grow}`}
          value={value ? (isTruthyBoolean(value) ? "1" : "0") : ""}
          onChange={(e) => onChange(e.target.value)}
        >
          {/* An imported clause can carry an empty value. Showing "No" for it
              would misreport what the filter actually does. */}
          {!value && <option value="">Choose…</option>}
          <option value="1">Yes</option>
          <option value="0">No</option>
        </select>
      );
    case "date":
      return (
        <DateValueInput
          value={value}
          inputClassName={inputClassName}
          selectClassName={selectClassName}
          onChange={onChange}
        />
      );
    case "duration":
      return (
        <DurationValueInput
          value={value}
          inputClassName={inputClassName}
          selectClassName={selectClassName}
          onChange={onChange}
        />
      );
    case "number":
    case "rating": {
      const suffix = fieldKind(field) === "rating" ? "/10" : fieldDef(field)?.unit;
      return (
        <span className={styles.wrap}>
          <input
            type="number"
            className={`${inputClassName ?? ""} ${styles.grow}`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {suffix && <span className={styles.suffix}>{suffix}</span>}
        </span>
      );
    }
    default:
      return (
        <input
          type="text"
          className={`${inputClassName ?? ""} ${styles.grow}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

// ─── Dates ──────────────────────────────────────────────────────────────────

const RELATIVE_UNITS: { unit: RelativeUnit; label: string }[] = [
  { unit: "d", label: "days ago" },
  { unit: "w", label: "weeks ago" },
  { unit: "mon", label: "months ago" },
  { unit: "y", label: "years ago" },
];

/** Sentinel for the "pick a calendar date instead" option in the unit select. */
const EXACT = "exact";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Plex accepts both a rolling offset (`-30d`) and a fixed date
 * (`2024-01-31`) here, and they answer different questions — "added recently"
 * versus "added before we migrated".
 *
 * Both modes render as one value plus one unit select, so the control is the
 * same width either way: the filter row in the collection drawer has no room
 * for a third box.
 */
function DateValueInput({
  value,
  inputClassName,
  selectClassName,
  onChange,
}: {
  value: string;
  inputClassName?: string;
  selectClassName?: string;
  onChange: (value: string) => void;
}) {
  const relative = parseRelativeDate(value);
  // Anything that isn't a recognised offset is edited as an exact date —
  // except an empty value, which starts as an offset since that's the far
  // more common filter.
  const isRelative = !!relative || !value;

  const switchUnit = (next: string) => {
    if (next === EXACT) {
      onChange(new Date().toISOString().slice(0, 10));
    } else {
      onChange(toRelativeDate(relative?.amount ?? 30, next as RelativeUnit));
    }
  };

  return (
    <span className={styles.wrap} title={relative ? formatCalendarDate(resolveRelativeDate(relative)) : undefined}>
      {isRelative ? (
        <input
          type="number"
          min={1}
          className={`${inputClassName ?? ""} ${styles.num}`}
          value={relative?.amount ?? ""}
          onChange={(e) => onChange(toRelativeDate(Math.max(1, Number(e.target.value) || 1), relative?.unit ?? "d"))}
        />
      ) : (
        <input
          type="date"
          className={`${inputClassName ?? ""} ${styles.grow}`}
          value={ISO_DATE.test(value) ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <select
        className={`${selectClassName ?? ""} ${styles.unit}`}
        value={isRelative ? (relative?.unit ?? "d") : EXACT}
        onChange={(e) => switchUnit(e.target.value)}
        aria-label="Date unit"
      >
        {RELATIVE_UNITS.map((u) => (
          <option key={u.unit} value={u.unit}>
            {u.label}
          </option>
        ))}
        <option value={EXACT}>on a date</option>
      </select>
    </span>
  );
}

// ─── Durations ──────────────────────────────────────────────────────────────

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** Plex stores runtimes in milliseconds; nobody thinks in milliseconds. */
function DurationValueInput({
  value,
  inputClassName,
  selectClassName,
  onChange,
}: {
  value: string;
  inputClassName?: string;
  selectClassName?: string;
  onChange: (value: string) => void;
}) {
  const ms = Number(value);
  const valid = Number.isFinite(ms) && ms > 0;
  // Show hours only when the stored value is a whole number of them, so
  // "90 minutes" doesn't become an unhelpful "1.5 hours".
  const unit = valid && ms % HOUR_MS === 0 ? HOUR_MS : MINUTE_MS;
  const amount = valid ? String(ms / unit) : "";

  const emit = (nextAmount: number, nextUnit: number) => {
    onChange(String(Math.max(0, Math.round(nextAmount * nextUnit))));
  };

  return (
    <span className={styles.wrap}>
      <input
        type="number"
        min={0}
        className={`${inputClassName ?? ""} ${styles.num}`}
        value={amount}
        onChange={(e) => emit(Number(e.target.value) || 0, unit)}
      />
      <select
        className={`${selectClassName ?? ""} ${styles.unit}`}
        value={unit}
        onChange={(e) => emit(Number(amount) || 0, Number(e.target.value))}
      >
        <option value={MINUTE_MS}>minutes</option>
        <option value={HOUR_MS}>hours</option>
      </select>
    </span>
  );
}
