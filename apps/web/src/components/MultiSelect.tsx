import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import styles from "./MultiSelect.module.css";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  /** Shown when nothing is selected, e.g. "All types". */
  allLabel: string;
  options: MultiSelectOption[];
  /** Selected values. Empty means "no filter" — every row passes. */
  selected: string[];
  onChange: (next: string[]) => void;
  /** Accessible name for the trigger. Defaults to `allLabel`. */
  ariaLabel?: string;
}

/**
 * A checkbox dropdown for filtering a table by several values at once.
 *
 * Replaces a row of one-per-value filter pills. Pills were single-select in
 * practice (clicking one replaced the last) and grew the toolbar by one control
 * per distinct value, so a page with eight rule types wrapped the filter bar
 * onto a second line and pushed everything after it out of alignment.
 *
 * Empty `selected` is "no filter" rather than "nothing matches" — the same
 * convention the previous "All types" pill used.
 */
export default function MultiSelect({ allLabel, options, selected, onChange, ariaLabel }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Swallow it: the palette and any open modal also listen for Escape, and
      // closing this menu shouldn't close the thing behind it as well.
      e.stopPropagation();
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, close]);

  const toggleValue = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const activeCount = selected.length;
  // One selection is worth naming; past that a count stays a fixed width and
  // keeps the toolbar from reflowing every time a box is ticked.
  const label = activeCount === 1 ? (options.find((o) => o.value === selected[0])?.label ?? allLabel) : allLabel;

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${activeCount > 0 ? styles.triggerActive : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel ?? allLabel}
      >
        <span>{label}</span>
        {activeCount > 1 && <span className={styles.count}>{activeCount}</span>}
        <ChevronDown className={styles.caret} size={13} strokeWidth={2.5} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.menu} id={menuId} role="group" aria-label={ariaLabel ?? allLabel}>
          {options.map((opt) => {
            const checked = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                role="checkbox"
                aria-checked={checked}
                className={styles.option}
                onClick={() => toggleValue(opt.value)}
              >
                <input type="checkbox" className={styles.optionCheck} checked={checked} readOnly tabIndex={-1} />
                <span>{opt.label}</span>
              </button>
            );
          })}
          <div className={styles.divider} />
          <button type="button" className={styles.clear} disabled={activeCount === 0} onClick={() => onChange([])}>
            {allLabel}
          </button>
        </div>
      )}
    </div>
  );
}
