import { useCallback, useMemo, useState } from "react";
import type { SortDir } from "#components/SortableTh";

/**
 * Comparable value for a row, per sort key. `null`/`undefined` always sort to
 * the end regardless of direction — an empty cell is missing data, not a very
 * small one, and letting it lead a descending sort buries the rows you asked for.
 */
type SortValue = string | number | boolean | null | undefined;

interface Options<T, K extends string> {
  rows: T[];
  /**
   * How to read each sortable column out of a row. This is the sole source of
   * `K` — the other key-typed options are wrapped in `NoInfer` so a short
   * `descFirst` list can't narrow the column set out from under the table.
   */
  accessors: Record<K, (row: T) => SortValue>;
  defaultKey: NoInfer<K>;
  defaultDir?: SortDir;
  /** Keys that start descending — timestamps, counts, sizes. */
  descFirst?: readonly NoInfer<K>[];
}

function compare(a: SortValue, b: SortValue): number {
  const aMissing = a === null || a === undefined || a === "";
  const bMissing = b === null || b === undefined || b === "";
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (typeof a === "string" && typeof b === "string") {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  }
  return Number(a) - Number(b);
}

/**
 * Client-side sort state for a table whose rows are already in memory.
 *
 * `useListParams` keeps sort in the URL, which is right for a list *page* but
 * wrong for panels: several tables can share one page (Stats, Jobs), and they'd
 * all read and fight over the same `?sort=`. This keeps it local to the table.
 */
export function useLocalSort<T, K extends string>({
  rows,
  accessors,
  defaultKey,
  defaultDir = "asc",
  descFirst = [],
}: Options<T, K>) {
  const [sortKey, setSortKey] = useState<K>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const toggleSort = useCallback(
    (key: K) => {
      if (key === sortKey) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir(descFirst.includes(key) ? "desc" : "asc");
      }
    },
    [sortKey, descFirst],
  );

  const sorted = useMemo(() => {
    const read = accessors[sortKey];
    if (!read) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    // Copy first: sorting the array from a query cache in place mutates data
    // React Query hands out to every other consumer of the same key.
    //
    // Negate the comparator rather than reversing the result — reversing also
    // flips rows that compared equal, so ties shuffle every time direction
    // changes instead of holding their order.
    return [...rows].sort((a, b) => {
      const av = read(a);
      const bv = read(b);
      const missing = av === null || av === undefined || av === "";
      const bMissing = bv === null || bv === undefined || bv === "";
      // Missing values pin to the bottom in both directions.
      if (missing || bMissing) return compare(av, bv);
      return dir * compare(av, bv);
    });
  }, [rows, accessors, sortKey, sortDir]);

  return { sortKey, sortDir, toggleSort, sorted };
}
