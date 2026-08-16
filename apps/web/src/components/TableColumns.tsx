import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./TableColumns.module.css";

/**
 * One column of a configurable table.
 *
 * Generic over the row so a page keeps its own type all the way into
 * `render` — the alternative is every cell starting with a cast.
 */
export interface TableColumn<T, Id extends string = string> {
  /**
   * Also the sort key on pages where the two coincide, which is why the id
   * type is a parameter — Media's ids are its `SortKey` union, and widening
   * them to `string` would lose that check at every `<SortableTh>`.
   */
  id: Id;
  label: string;
  render: (row: T) => ReactNode;
  /** Machine-produced values are set in mono, like everywhere else in the app. */
  mono?: boolean;
  /**
   * Role this cell takes when the table becomes cards on mobile. Columns are
   * user-configurable, so the role travels with the column rather than being
   * inferred from its position in the row.
   */
  mobile?: "title" | "meta" | "hide";
  /** Sort key, when this column is sortable. Absent means it isn't. */
  sortKey?: string;
}

export type ColumnConfig = { id: string; visible: boolean };

/**
 * The saved column config, brought up to date with the columns we now ship.
 *
 * A saved config is a complete list, and both the table and the Columns
 * dropdown iterate it rather than the full set — so a column added after
 * someone last saved would be invisible *and* absent from the control that
 * turns it on. Missing columns are appended at their default visibility, which
 * keeps the order and the choices they made and still shows them the new
 * column. Columns we have dropped fall away by not being in `all`.
 */
export function reconcileColumns<Id extends string>(
  /** Only the ids are read, so a bare id list is a valid argument. */
  all: ReadonlyArray<{ id: Id }>,
  defaultVisible: string[],
  saved: ColumnConfig[] | null | undefined,
): ColumnConfig[] {
  const defaults = all.map((col) => ({ id: col.id, visible: defaultVisible.includes(col.id) }));
  if (!saved || saved.length === 0) return defaults;
  // Widened deliberately: a saved config is whatever was in the database, so
  // its ids are strings and not necessarily ones we still ship.
  const known: Set<string> = new Set(all.map((c) => c.id));
  const kept = saved.filter((c) => known.has(c.id));
  const seen = new Set(kept.map((c) => c.id));
  return [...kept, ...defaults.filter((c) => !seen.has(c.id))];
}

/**
 * Which columns to draw, in the configured order.
 *
 * Returns column defs rather than ids so callers never have to look one up
 * again — a `find(...)!` per cell was where the old copy of this leaked its
 * non-null assertions.
 */
export function visibleColumns<T, Id extends string>(
  all: TableColumn<T, Id>[],
  config: ColumnConfig[],
): TableColumn<T, Id>[] {
  return config
    .filter((c) => c.visible)
    .map((c) => all.find((col) => col.id === c.id))
    .filter((col): col is TableColumn<T, Id> => !!col);
}

/**
 * The "Columns" button and its drag-to-reorder checklist.
 *
 * Extracted from the Media page so the Collections table could have the same
 * control rather than a second one that drifts from it — the reasoning the
 * `no-shadowed-primitive` lint rule already applies to stylesheets.
 */
export function ColumnsButton<T, Id extends string>({
  all,
  config,
  onChange,
  label = "Columns",
}: {
  all: TableColumn<T, Id>[];
  config: ColumnConfig[];
  /** Called with the whole next config; the caller persists it. */
  onChange: (next: ColumnConfig[]) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const toggle = (id: string) => {
    const next = config.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c));
    // Every column hidden leaves a table of blank rows and no way back except
    // this menu, which is behind them. The last visible one stays on.
    if (next.some((c) => c.visible)) onChange(next);
  };

  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...config];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        className={`${styles.trigger} ${open ? styles.triggerActive : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <div className={styles.dropdown}>
          <div className={styles.title}>Drag to reorder</div>
          {config.map((col, i) => {
            const def = all.find((c) => c.id === col.id);
            if (!def) return null;
            return (
              <div
                key={col.id}
                className={`${styles.item} ${dragIndex === i ? styles.itemDragging : ""}`}
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null && dragIndex !== i) {
                    move(dragIndex, i);
                    setDragIndex(i);
                  }
                }}
                onDragEnd={() => setDragIndex(null)}
              >
                <span className={styles.handle}>&#x2630;</span>
                <label className={styles.itemLabel}>
                  <input type="checkbox" checked={col.visible} onChange={() => toggle(col.id)} />
                  {def.label}
                </label>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
