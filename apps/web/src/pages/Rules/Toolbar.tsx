import { useMemo, type RefObject } from "react";
import MultiSelect from "#components/MultiSelect";
import SearchInput from "#components/SearchInput";
import { TYPE_LABELS } from "./constants";
import styles from "./Rules.module.css";
import type { EnabledFilter, SortKey } from "./types";

interface RulesToolbarProps {
  searchInputRef: RefObject<HTMLInputElement | null>;
  search: string;
  onSearchChange: (value: string) => void;
  presentTypes: string[];
  /** Selected rule types. Empty means every type passes. */
  typeFilter: string[];
  onTypeFilterChange: (value: string[]) => void;
  enabledFilter: EnabledFilter;
  onEnabledFilterChange: (value: EnabledFilter) => void;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSortChange: (sortKey: SortKey, sortDir: "asc" | "desc") => void;
}

export default function RulesToolbar({
  searchInputRef,
  search,
  onSearchChange,
  presentTypes,
  typeFilter,
  onTypeFilterChange,
  enabledFilter,
  onEnabledFilterChange,
  sortKey,
  sortDir,
  onSortChange,
}: RulesToolbarProps) {
  const typeOptions = useMemo(
    () =>
      presentTypes
        .map((t) => ({ value: t, label: TYPE_LABELS[t] || t }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [presentTypes],
  );

  return (
    <div className={styles.toolbar}>
      <SearchInput ref={searchInputRef} grow placeholder="Search rules…" value={search} onChange={onSearchChange} />
      <MultiSelect
        allLabel="All types"
        ariaLabel="Filter by rule type"
        options={typeOptions}
        selected={typeFilter}
        onChange={onTypeFilterChange}
      />
      <span className={styles.filterDivider} />
      <div className={styles.segmented} role="tablist">
        <button
          type="button"
          className={`${styles.segmentedBtn} ${enabledFilter === "all" ? styles.segmentedBtnActive : ""}`}
          onClick={() => onEnabledFilterChange("all")}
        >
          All
        </button>
        <button
          type="button"
          className={`${styles.segmentedBtn} ${enabledFilter === "enabled" ? styles.segmentedBtnActive : ""}`}
          onClick={() => onEnabledFilterChange("enabled")}
        >
          Enabled
        </button>
        <button
          type="button"
          className={`${styles.segmentedBtn} ${enabledFilter === "disabled" ? styles.segmentedBtnActive : ""}`}
          onClick={() => onEnabledFilterChange("disabled")}
        >
          Disabled
        </button>
      </div>
      <select
        className={styles.sortSelect}
        value={`${sortKey}:${sortDir}`}
        onChange={(e) => {
          const [k, d] = e.target.value.split(":") as [SortKey, "asc" | "desc"];
          onSortChange(k, d);
        }}
        aria-label="Sort rules"
      >
        <option value="name:asc">Name (A→Z)</option>
        <option value="name:desc">Name (Z→A)</option>
        <option value="type:asc">Type (A→Z)</option>
        <option value="lastRun:desc">Last run (recent first)</option>
        <option value="lastRun:asc">Last run (oldest first)</option>
      </select>
    </div>
  );
}
