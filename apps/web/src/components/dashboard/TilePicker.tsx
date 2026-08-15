import { LayoutGrid } from "lucide-react";
import type React from "react";
import { Children, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMediaQuery } from "#hooks/useMediaQuery";
import { Sparkline } from "./Sparkline";
import styles from "./Dashboard.module.css";

export interface TileDef {
  id: string;
  label: string;
  /** Heading the tile sits under in the picker. */
  group: string;
}

/**
 * The saved selection, cleaned up: tiles we no longer ship are dropped, and an
 * empty (or absent) selection falls back to the page's defaults rather than
 * rendering a bare summary bar.
 */
export function resolveTiles(saved: string[] | undefined, registry: TileDef[], defaults: string[], max: number) {
  const known = registry.map((t) => t.id);
  const cleaned = (saved ?? []).filter((id) => known.includes(id));
  return (cleaned.length > 0 ? cleaned : defaults).slice(0, max);
}

/** A single metric card in the summary bar. */
export function SummaryTile({
  label,
  value,
  sub,
  tone,
  trend,
  to,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** "small" for text values (times, names); "accent" or "danger" to draw the eye. */
  tone?: "small" | "accent" | "danger";
  /** Recent history for this metric, drawn on the value line. */
  trend?: number[];
  /**
   * Where this metric is explained in full — the filtered list it counts.
   * Whole-tile link rather than a link inside the sub: an 11px line of text is
   * a poor tap target, and the tile is already the unit you point at.
   *
   * Only worth setting when the destination shows the thing the tile counts. A
   * tile that links to an empty list has spent a click to say "nothing here",
   * which the tile already said.
   */
  to?: string;
}) {
  const valueClass = [
    styles.summaryValue,
    tone === "small" ? styles.summaryValueSmall : "",
    tone === "accent" ? styles.summaryValueAccent : "",
    tone === "danger" ? styles.summaryValueDanger : "",
  ]
    .filter(Boolean)
    .join(" ");
  // Both the value line and the sub line are always rendered, sub included when
  // there's nothing to put in it. A tile whose sub appears the moment a stream
  // starts — or whose value goes from an 11px skeleton to a 25px metric — would
  // otherwise change height under its neighbours, and every tile in the row
  // stretches to match, so one tile's news moves the whole page.
  const body = (
    <>
      <span className={styles.summaryLabel}>{label}</span>
      <span className={valueClass}>
        <span className={styles.summaryValueLine}>
          {value}
          {trend && trend.length > 1 && <Sparkline values={trend} label="Recent history" />}
        </span>
        <span className={styles.summarySub}>
          {sub}
          {to != null && (
            <span className={styles.summarySubArrow} aria-hidden="true">
              →
            </span>
          )}
        </span>
      </span>
    </>
  );

  if (to == null) return <div className={styles.summaryItem}>{body}</div>;
  return (
    <Link to={to} className={`${styles.summaryItem} ${styles.summaryItemLink}`}>
      {body}
    </Link>
  );
}

export function SummaryBar({ children }: { children: React.ReactNode }) {
  return <div className={styles.summaryBar}>{children}</div>;
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className={styles.dashboard}>{children}</div>;
}

/**
 * Two columns of panels, each panel pinned to the slot its order gives it.
 *
 * This used to be a CSS `column-count: 2` masonry, which balances the two
 * columns by *height*: a panel gaining a row — a stream starting, a job
 * finishing, a query landing — could push the panel below it into the other
 * column, so panels swapped places under the pointer while you read them.
 * Assigning odd/even indices to the two columns costs the height balancing and
 * buys a layout that only moves when the user reorders it.
 *
 * Below the breakpoint it's a single column in plain order, which is why the
 * split is here rather than in CSS: the columns are real elements, so the
 * two-column DOM order (0, 2, 4, 1, 3, 5) is not the order to read on a phone.
 */
export function DashboardGrid({ children }: { children: React.ReactNode }) {
  const singleColumn = useMediaQuery("(max-width: 768px)");
  const panels = Children.toArray(children);
  const columns = singleColumn
    ? [panels]
    : [panels.filter((_, i) => i % 2 === 0), panels.filter((_, i) => i % 2 === 1)];

  return (
    <div className={styles.grid}>
      {columns.map((column, i) => (
        <div key={i} className={styles.gridColumn}>
          {column}
        </div>
      ))}
    </div>
  );
}

/**
 * Popover for choosing which metric tiles a dashboard shows and in what order.
 * Edits are held as a draft so a half-finished selection never hits the server;
 * only Save commits.
 */
export function TilePicker({
  registry,
  selected,
  max,
  onSave,
}: {
  registry: TileDef[];
  selected: string[];
  max: number;
  onSave: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(selected), [selected.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggle = (id: string) => {
    setDraft((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= max) return prev;
      return [...prev, id];
    });
  };

  const move = (from: number, to: number) => {
    setDraft((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const dragIndex = useRef<number | null>(null);

  const groups: Record<string, TileDef[]> = {};
  for (const t of registry) {
    (groups[t.group] ||= []).push(t);
  }

  return (
    <div className={styles.tilePicker} ref={ref}>
      <button
        className={styles.tilePickerButton}
        onClick={() => setOpen((v) => !v)}
        title="Customize tiles"
        aria-label="Customize tiles"
      >
        <LayoutGrid size={16} strokeWidth={2} />
      </button>
      {open && (
        <div className={styles.tilePickerPopover}>
          <div className={styles.tilePickerHeader}>
            <span>Choose up to {max} tiles</span>
            <span className={styles.tilePickerCount}>
              {draft.length} / {max}
            </span>
          </div>
          {draft.length > 0 && (
            <div className={styles.tilePickerOrder}>
              <div className={styles.tilePickerGroupLabel}>Order (drag or use arrows)</div>
              {draft.map((id, i) => {
                const def = registry.find((t) => t.id === id);
                if (!def) return null;
                return (
                  <div
                    key={id}
                    className={styles.tilePickerOrderItem}
                    draggable
                    onDragStart={(e) => {
                      dragIndex.current = i;
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = dragIndex.current;
                      dragIndex.current = null;
                      if (from == null || from === i) return;
                      move(from, i);
                    }}
                  >
                    <span className={styles.tilePickerHandle} aria-hidden>
                      ⋮⋮
                    </span>
                    <span className={styles.tilePickerOrderLabel}>{def.label}</span>
                    <button
                      className={styles.tilePickerArrow}
                      onClick={() => move(i, i - 1)}
                      disabled={i === 0}
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      className={styles.tilePickerArrow}
                      onClick={() => move(i, i + 1)}
                      disabled={i === draft.length - 1}
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button className={styles.tilePickerRemove} onClick={() => toggle(id)} aria-label="Remove">
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className={styles.tilePickerList}>
            {Object.entries(groups).map(([group, items]) => (
              <div key={group} className={styles.tilePickerGroup}>
                <div className={styles.tilePickerGroupLabel}>{group}</div>
                {items.map((t) => {
                  const isSel = draft.includes(t.id);
                  const disabled = !isSel && draft.length >= max;
                  return (
                    <label
                      key={t.id}
                      className={`${styles.tilePickerOption} ${disabled ? styles.tilePickerOptionDisabled : ""}`}
                    >
                      <input type="checkbox" checked={isSel} disabled={disabled} onChange={() => toggle(t.id)} />
                      <span>{t.label}</span>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
          <div className={styles.tilePickerActions}>
            <button
              className={styles.tilePickerSave}
              onClick={() => {
                onSave(draft);
                setOpen(false);
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
