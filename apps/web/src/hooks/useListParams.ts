import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { readEnum } from "#/storage";
import type { SortDir } from "#components/SortableTh";

interface Options<K extends string> {
  sortKeys: readonly K[];
  defaultSortKey: K;
  /** Direction used when a column is first selected. Per-key overrides below. */
  defaultSortDir?: SortDir;
  /**
   * Columns that should start descending when first clicked — timestamps and
   * counts, where "most recent" / "most" is the useful first look.
   */
  descFirst?: readonly K[];
}

/**
 * List-page state (search, filters, page, sort) held in the URL.
 *
 * Sort used to live in localStorage on Media, Events, Users and Jobs but in the
 * URL on Collections, so sharing or bookmarking a Collections view reproduced
 * its sort and the sibling pages silently didn't. The URL wins: it's
 * shareable, survives reload, and back/forward behave.
 */
export function useListParams<K extends string>({
  sortKeys,
  defaultSortKey,
  defaultSortDir = "asc",
  descFirst = [],
}: Options<K>) {
  const [searchParams, setSearchParams] = useSearchParams();

  const sortKey = readEnum(searchParams.get("sort"), sortKeys, defaultSortKey);
  const sortDir: SortDir = readEnum(searchParams.get("dir"), ["asc", "desc"] as const, defaultSortDir);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  /** Reads an arbitrary filter param. */
  const param = useCallback((key: string) => searchParams.get(key) ?? "", [searchParams]);

  /**
   * Reads a multi-value filter param — every selection of a MultiSelect.
   *
   * Repeated keys (`?type=movie&type=show`) rather than one delimited value:
   * the values include Plex labels and collection titles, which are free text
   * and do contain commas.
   */
  const listParam = useCallback((key: string) => searchParams.getAll(key), [searchParams]);

  const setParams = useCallback(
    (patch: Record<string, string>, opts?: { keepPage?: boolean }) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          // Any change other than paging invalidates the current page number.
          if (!opts?.keepPage && !("page" in patch)) next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setParam = useCallback((key: string, value: string) => setParams({ [key]: value }), [setParams]);

  /** Replaces every value of a multi-value filter param. */
  const setListParam = useCallback(
    (key: string, values: string[]) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(key);
          for (const value of values) next.append(key, value);
          // Same rule as setParams: changing a filter invalidates the page.
          next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setPage = useCallback((next: number) => setParams({ page: next <= 1 ? "" : String(next) }), [setParams]);

  /** Toggles direction on the active column, or switches to a new one. */
  const toggleSort = useCallback(
    (key: K) => {
      if (key === sortKey) {
        setParams({ sort: key, dir: sortDir === "asc" ? "desc" : "asc" });
      } else {
        setParams({ sort: key, dir: descFirst.includes(key) ? "desc" : "asc" });
      }
    },
    [sortKey, sortDir, setParams, descFirst],
  );

  return { sortKey, sortDir, page, param, listParam, setParam, setListParam, setParams, setPage, toggleSort };
}
