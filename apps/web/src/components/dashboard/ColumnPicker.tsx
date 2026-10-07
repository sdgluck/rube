import { Columns3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./Dashboard.module.css";

export interface PanelColumnDef {
  id: string;
  label: string;
  /** Heading the column sits under in the picker. */
  group: string;
  /** Structural columns — the title, the status marker — that can't be turned off. */
  fixed?: boolean;
}

/**
 * The saved selection, brought up to date with the columns we now ship.
 *
 * Columns we've dropped fall away; fixed columns are always present regardless
 * of what was saved. An absent selection means the panel has never been
 * configured, which is the defaults — but an explicitly emptied one is honoured,
 * so unticking everything doesn't silently restore the defaults.
 */
export function resolveColumns(saved: string[] | undefined, registry: PanelColumnDef[], defaults: string[]): string[] {
  const known = new Set(registry.map((c) => c.id));
  const chosen = saved === undefined ? defaults : saved.filter((id) => known.has(id));
  const picked = new Set(chosen);
  // Registry order, not saved order: the panel's columns read left to right in a
  // deliberate sequence (what, who, how) that a drag-reorder would only muddle.
  return registry.filter((c) => c.fixed || picked.has(c.id)).map((c) => c.id);
}

/** Popover for choosing which columns a panel's table shows. */
export function ColumnPicker({
  registry,
  selected,
  onSave,
}: {
  registry: PanelColumnDef[];
  /** Currently visible ids, fixed columns included. */
  selected: string[];
  onSave: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const optional = registry.filter((c) => !c.fixed);
  const isSelected = (id: string) => selected.includes(id);

  // Saved immediately rather than behind a Save button: one checkbox is the
  // whole edit, and the table behind the popover shows the result as you tick.
  const toggle = (id: string) => {
    const next = optional.filter((c) => (c.id === id ? !isSelected(c.id) : isSelected(c.id))).map((c) => c.id);
    onSave(next);
  };

  const groups: Record<string, PanelColumnDef[]> = {};
  for (const c of optional) {
    (groups[c.group] ||= []).push(c);
  }

  return (
    <div className={styles.tilePicker} ref={ref}>
      <button
        className={styles.tilePickerButton}
        onClick={() => setOpen((v) => !v)}
        title="Choose columns"
        aria-label="Choose columns"
      >
        <Columns3 size="1.5rem" strokeWidth={2} />
      </button>
      {open && (
        <div className={styles.tilePickerPopover}>
          <div className={styles.tilePickerHeader}>
            <span>Columns</span>
            <span className={styles.tilePickerCount}>{selected.length}</span>
          </div>
          <div className={styles.tilePickerList}>
            {Object.entries(groups).map(([group, items]) => (
              <div key={group} className={styles.tilePickerGroup}>
                <div className={styles.tilePickerGroupLabel}>{group}</div>
                {items.map((c) => (
                  <label key={c.id} className={styles.tilePickerOption}>
                    <input type="checkbox" checked={isSelected(c.id)} onChange={() => toggle(c.id)} />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
