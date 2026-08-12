import { useMemo, type RefObject } from "react";
import MultiSelect from "#components/MultiSelect";
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
      <div className={styles.searchWrap}>
        <span className={styles.searchIcon} aria-hidden="true">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          ref={searchInputRef}
          type="text"
          className={styles.search}
          placeholder="Search rules…  (press / to focus)"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
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
