import { Rows3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./Dashboard.module.css";

export interface PanelDef {
  id: string;
  /** The panel's own title, so the picker and the header agree. */
  label: string;
  /** One line on what the panel shows, for panels whose title can't carry it. */
  hint?: string;
}

/**
 * Which panels a dashboard shows.
 *
 * Unlike `TilePicker` this commits each change immediately rather than holding
 * a draft behind a Save button. There is no cap to enforce and no order to get
 * half-right, and the popover doesn't cover the grid — so switching a panel on
 * shows you the panel, which is a better answer than a preview would be.
 *
 * Order is not set here either: panels are dragged into place on the grid
 * itself, where you can see what you're arranging.
 */
export function PanelPicker({
  registry,
  hidden,
  onToggle,
  onShowAll,
}: {
  registry: readonly PanelDef[];
  /** Ids currently switched off. */
  hidden: (id: string) => boolean;
  onToggle: (id: string) => void;
  onShowAll: () => void;
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

  const shown = registry.filter((p) => !hidden(p.id)).length;

  return (
    <div className={styles.tilePicker} ref={ref}>
      <button
        className={styles.tilePickerButton}
        onClick={() => setOpen((v) => !v)}
        title="Choose panels"
        aria-label="Choose panels"
      >
        <Rows3 size={16} strokeWidth={2} />
      </button>
      {open && (
        <div className={styles.tilePickerPopover}>
          <div className={styles.tilePickerHeader}>
            <span>Panels</span>
            <span className={styles.tilePickerCount}>
              {shown} / {registry.length}
            </span>
          </div>
          <div className={styles.tilePickerList}>
            {registry.map((panel) => (
              <label key={panel.id} className={styles.tilePickerOption}>
                <input type="checkbox" checked={!hidden(panel.id)} onChange={() => onToggle(panel.id)} />
                <span className={styles.panelPickerLabel}>
                  {panel.label}
                  {panel.hint && <span className={styles.panelPickerHint}>{panel.hint}</span>}
                </span>
              </label>
            ))}
          </div>
          <div className={styles.tilePickerActions}>
            <button
              className={styles.tilePickerSave}
              onClick={onShowAll}
              disabled={shown === registry.length}
              title="Switch every panel back on"
            >
              Show all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
