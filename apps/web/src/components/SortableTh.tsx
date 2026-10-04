import type { ReactNode } from "react";
import styles from "./SortableTh.module.css";

export type SortDir = "asc" | "desc";

interface SortableThProps<K extends string> {
  /** The sort key this column controls. */
  sortKey: K;
  /** The currently active sort key, across the whole table. */
  activeKey: K;
  activeDir: SortDir;
  onSort: (key: K) => void;
  children: ReactNode;
  className?: string;
  /** Hover text for columns whose label can't carry the whole meaning. */
  title?: string;
}

/**
 * A sortable table header.
 *
 * Five pages implemented this as `<th onClick>` with an arrow glyph appended to
 * the label text: not focusable, not operable by keyboard, and with no
 * aria-sort anywhere in the app. The interactive element is now a real button
 * and the sort state is exposed on the <th>.
 */
export default function SortableTh<K extends string>({
  sortKey,
  activeKey,
  activeDir,
  onSort,
  children,
  className,
  title,
}: SortableThProps<K>) {
  const active = activeKey === sortKey;
  return (
    <th
      className={`${styles.th} ${className ?? ""}`}
      aria-sort={active ? (activeDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" className={styles.sortHeader} title={title} onClick={() => onSort(sortKey)}>
        <span>{children}</span>
        <span className={active ? styles.arrowActive : styles.arrow} aria-hidden="true">
          {active ? (activeDir === "asc" ? "▲" : "▼") : "▾"}
        </span>
      </button>
    </th>
  );
}
