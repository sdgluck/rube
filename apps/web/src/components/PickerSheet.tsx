import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { haptic } from "@tinkerbell/native-client";
import Modal from "./Modal";
import styles from "./PickerSheet.module.css";

export type PickerOption = { value: string; label: string; detail?: string };

/**
 * A phone's picker: a sheet of options with a search field and checkmarks.
 *
 * The desktop's dropdowns (`MultiSelect`, `Combobox`) are lists hanging off a
 * field, sized for a pointer and closed by the first stray scroll. Native
 * apps pick from a sheet instead — the whole width, rows a thumb can hit, a
 * search field once there are more than a handful. `multiple` keeps the sheet
 * open while ticking; single choice closes it on the first tap.
 */
export default function PickerSheet({
  open,
  onClose,
  title,
  options,
  selected,
  onToggle,
  multiple = false,
  clearLabel,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  options: PickerOption[];
  selected: string[];
  onToggle: (value: string) => void;
  multiple?: boolean;
  /** A "clear" row at the top (e.g. "All types"), shown when anything is picked. */
  clearLabel?: string;
  onClear?: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <Modal open={open} onClose={onClose} title={title} size="md">
      {options.length > 8 && (
        <input
          className={styles.search}
          type="search"
          placeholder="Search"
          value={query}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(e) => setQuery(e.target.value)}
          aria-label={`Search ${title}`}
        />
      )}
      <div className={styles.list} role="listbox" aria-multiselectable={multiple}>
        {clearLabel && onClear && (
          <button
            type="button"
            role="option"
            aria-selected={selected.length === 0}
            className={styles.option}
            onClick={() => {
              haptic("selection");
              onClear();
              if (!multiple) onClose();
            }}
          >
            <span className={styles.label}>{clearLabel}</span>
            {selected.length === 0 && <Check className={styles.check} size="2rem" strokeWidth={2.5} aria-hidden />}
          </button>
        )}
        {shown.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={on}
              className={styles.option}
              onClick={() => {
                haptic("selection");
                onToggle(o.value);
                if (!multiple) onClose();
              }}
            >
              <span className={styles.label}>
                {o.label}
                {o.detail && <span className={styles.detail}>{o.detail}</span>}
              </span>
              {on && <Check className={styles.check} size="2rem" strokeWidth={2.5} aria-hidden />}
            </button>
          );
        })}
        {shown.length === 0 && <p className={styles.empty}>Nothing matches “{query.trim()}”.</p>}
      </div>
    </Modal>
  );
}
