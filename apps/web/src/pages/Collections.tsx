import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import pMap from "p-map";
import { trpc } from "../trpc";
import ConfirmModal from "../ConfirmModal";
import { CollectionsSkeleton } from "../Skeleton";
import EmptyState from "../EmptyState";
import FadeImage from "../FadeImage";
import RelativeTime from "../RelativeTime";
import { useToast } from "../Toast";
import PullToRefresh from "../PullToRefresh";
import { readEnum, readEnumStorage } from "../storage";
import styles from "./Collections.module.css";

const SORT_KEYS = ["title", "sectionTitle", "childCount", "smart", "labels", "addedAt"] as const;
type SortKey = (typeof SORT_KEYS)[number];
type SortDir = "asc" | "desc";
const VIEW_MODES = ["table", "grid"] as const;
type ViewMode = (typeof VIEW_MODES)[number];
const PAGE_SIZE = 50;

export default function Collections() {
  const [searchParams, setSearchParams] = useSearchParams();

  const sectionFilter = searchParams.get("section") ?? "";
  const labelFilter = searchParams.get("label") ?? "";
  const search = searchParams.get("q") ?? "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const sortKey: SortKey = readEnum(searchParams.get("sort"), SORT_KEYS, "title");
  const sortDir: SortDir = searchParams.get("dir") === "desc" ? "desc" : "asc";
  const [viewMode, setViewMode] = useState<ViewMode>(() => readEnumStorage("collections-view", VIEW_MODES, "table"));

  const setParam = useCallback(
    (key: string, value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) {
            next.set(key, value);
          } else {
            next.delete(key);
          }
          // Reset page when filters/sort change
          if (key !== "page") {
            next.delete("page");
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setSectionFilter = useCallback((v: string) => setParam("section", v), [setParam]);
  const setLabelFilter = useCallback((v: string) => setParam("label", v), [setParam]);
  const setSearch = useCallback((v: string) => setParam("q", v), [setParam]);

  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const { addToast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; label?: string } | null>(null);
  const [labelEditing, setLabelEditing] = useState(false);
  const [labelsToAdd, setLabelsToAdd] = useState("");
  const [labelsToRemove, setLabelsToRemove] = useState<Set<string>>(new Set());
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const lastClickedIndex = useRef<number | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const offset = (page - 1) * PAGE_SIZE;

  const collectionsQuery = trpc.collections.list.useQuery(
    {
      sectionId: sectionFilter || undefined,
      label: labelFilter || undefined,
      search: debouncedSearch || undefined,
      offset,
      limit: PAGE_SIZE,
      sort: sortKey,
      sortDir,
    },
    { refetchOnWindowFocus: false, placeholderData: keepPreviousData },
  );

  // Lightweight query for populating filter dropdowns
  const filtersQuery = trpc.collections.filters.useQuery(undefined, { refetchOnWindowFocus: false });

  const deleteMutation = trpc.collections.delete.useMutation();
  const updateLabelsMutation = trpc.collections.updateLabels.useMutation();

  const collections = collectionsQuery.data?.items ?? [];
  const total = collectionsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const parseLabels = (labels: string[] | null | undefined): string[] => labels ?? [];

  // Derive sections and labels from lightweight filters query
  const sections = filtersQuery.data?.sections ?? [];
  const allLabels = filtersQuery.data?.labels ?? [];

  const toggleSort = (key: SortKey) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (sortKey === key) {
          const newDir = sortDir === "asc" ? "desc" : "asc";
          if (newDir === "asc") next.delete("dir");
          else next.set("dir", newDir);
        } else {
          if (key === "title") next.delete("sort");
          else next.set("sort", key);
          next.delete("dir");
        }
        // Reset page on sort change
        next.delete("page");
        return next;
      },
      { replace: true },
    );
  };

  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : "");

  // Unique labels across selected collections
  const selectedLabels = [
    ...new Set(collections.filter((c) => selected.has(c.plexRatingKey)).flatMap((c) => parseLabels(c.labels))),
  ].sort();

  // Clear selection when filters change
  useEffect(() => {
    setSelected(new Set());
    setLabelEditing(false);
  }, [sectionFilter, labelFilter, debouncedSearch]);

  const handleDelete = (ratingKey: string, title: string) => {
    setPendingConfirm({
      message: `Delete "${title}"? This will remove it from Plex.`,
      onConfirm: async () => {
        setPendingConfirm(null);
        try {
          await deleteMutation.mutateAsync({ ratingKey });
          addToast(`Deleted "${title}"`, "success");
          collectionsQuery.refetch();
          filtersQuery.refetch();
        } catch {
          addToast(`Failed to delete "${title}"`, "error");
        }
      },
    });
  };

  const handleBulkDelete = () => {
    const count = selected.size;
    setPendingConfirm({
      message: `Delete ${count} collection(s)? This will remove them from Plex.`,
      onConfirm: async () => {
        setPendingConfirm(null);
        setBulkProgress({ done: 0, total: count });
        let deleted = 0;
        let failed = 0;
        await pMap(
          [...selected],
          async (ratingKey) => {
            try {
              await deleteMutation.mutateAsync({ ratingKey });
              deleted++;
            } catch {
              failed++;
            }
            setBulkProgress({ done: deleted + failed, total: count });
          },
          { concurrency: 5 },
        );
        setSelected(new Set());
        setBulkProgress(null);
        if (failed > 0) {
          addToast(`Deleted ${deleted}, failed ${failed}`, "error");
        } else {
          addToast(`Deleted ${deleted} collection(s)`, "success");
        }
        collectionsQuery.refetch();
        filtersQuery.refetch();
      },
    });
  };

  const handleBulkEditLabels = async () => {
    const addList = labelsToAdd
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const removeSet = labelsToRemove;

    if (addList.length === 0 && removeSet.size === 0) return;

    const selectedCollections = collections.filter((c) => selected.has(c.plexRatingKey));
    const total = selectedCollections.length;
    setBulkProgress({ done: 0, total, label: "Updating labels" });

    let updated = 0;
    let failed = 0;
    for (const col of selectedCollections) {
      const current = parseLabels(col.labels);
      const newLabels = [...new Set([...current.filter((l) => !removeSet.has(l)), ...addList])];
      try {
        await updateLabelsMutation.mutateAsync({ ratingKey: col.plexRatingKey, labels: newLabels });
        updated++;
      } catch {
        failed++;
      }
      setBulkProgress({ done: updated + failed, total, label: "Updating labels" });
    }

    setSelected(new Set());
    setBulkProgress(null);
    setLabelEditing(false);
    setLabelsToAdd("");
    setLabelsToRemove(new Set());
    if (failed > 0) {
      addToast(`Updated ${updated}, failed ${failed}`, "error");
    } else {
      addToast(`Updated labels on ${updated} collection(s)`, "success");
    }
    collectionsQuery.refetch();
    filtersQuery.refetch();
  };

  const handleCheckboxClick = (index: number, e: React.MouseEvent) => {
    const key = collections[index].plexRatingKey;

    if (e.shiftKey && lastClickedIndex.current != null) {
      const from = Math.min(lastClickedIndex.current, index);
      const to = Math.max(lastClickedIndex.current, index);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) {
          next.add(collections[i].plexRatingKey);
        }
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    }

    lastClickedIndex.current = index;
  };

  const toggleSelectAll = () => {
    if (selected.size === collections.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(collections.map((c) => c.plexRatingKey)));
    }
  };

  if (collectionsQuery.isLoading && !collectionsQuery.data) return <CollectionsSkeleton />;
  if (collectionsQuery.error)
    return <div className={`${styles.toast} ${styles.error}`}>Failed to load collections</div>;

  return (
    <PullToRefresh
      onRefresh={() => {
        collectionsQuery.refetch();
        filtersQuery.refetch();
      }}
    >
      <div>
        <h2 className={styles.heading}>Collections{total > 0 && <span className="count-badge">{total}</span>}</h2>

        {(selected.size > 0 || bulkProgress) && (
          <>
            <div
              className={styles.bulkBar}
              style={labelEditing ? { borderRadius: "6px 6px 0 0", marginBottom: 0 } : undefined}
            >
              {bulkProgress ? (
                <>
                  <span className={styles.bulkCount}>
                    {bulkProgress.label || "Deleting"} {bulkProgress.done}/{bulkProgress.total}...
                  </span>
                  <div className={styles.bulkProgressBar}>
                    <div
                      className={styles.bulkProgressFill}
                      style={{ width: `${Math.round((bulkProgress.done / bulkProgress.total) * 100)}%` }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <span className={styles.bulkCount}>{selected.size} selected</span>
                  <button
                    className={`${styles.buttonSmall} ${labelEditing ? styles.button : styles.buttonSecondary}`}
                    onClick={() => {
                      setLabelEditing(!labelEditing);
                      setLabelsToAdd("");
                      setLabelsToRemove(new Set());
                    }}
                  >
                    Edit Labels
                  </button>
                  <button className={`${styles.buttonDanger} ${styles.buttonSmall}`} onClick={handleBulkDelete}>
                    Delete {selected.size}
                  </button>
                  <button
                    className={`${styles.buttonSmall} ${styles.buttonSecondary}`}
                    onClick={() => {
                      setSelected(new Set());
                      setLabelEditing(false);
                    }}
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
            {labelEditing && !bulkProgress && (
              <div className={styles.labelEditor}>
                <div className={styles.labelEditorRow}>
                  <label>Add labels:</label>
                  <input
                    type="text"
                    className={styles.labelEditorInput}
                    placeholder="Label1, Label2, ..."
                    value={labelsToAdd}
                    onChange={(e) => setLabelsToAdd(e.target.value)}
                  />
                </div>
                {selectedLabels.length > 0 && (
                  <div className={styles.labelEditorRow}>
                    <label>Remove labels:</label>
                    <div className={styles.labelCheckboxList}>
                      {selectedLabels.map((lbl) => (
                        <span key={lbl} className={styles.labelCheckboxItem}>
                          <input
                            type="checkbox"
                            checked={labelsToRemove.has(lbl)}
                            onChange={() =>
                              setLabelsToRemove((prev) => {
                                const next = new Set(prev);
                                if (next.has(lbl)) next.delete(lbl);
                                else next.add(lbl);
                                return next;
                              })
                            }
                          />
                          <span
                            className={`${styles.label} ${["tinkerbell", "generated", "becauseyouwatched"].includes(lbl.toLowerCase()) ? styles.labelTinkerbell : lbl.toLowerCase().startsWith("user:") ? styles.labelUser : ""}`}
                          >
                            {lbl}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className={styles.labelEditorActions}>
                  <button
                    className={`${styles.button} ${styles.buttonSmall}`}
                    onClick={handleBulkEditLabels}
                    disabled={labelsToAdd.trim() === "" && labelsToRemove.size === 0}
                  >
                    Apply
                  </button>
                  <button
                    className={`${styles.buttonSecondary} ${styles.buttonSmall}`}
                    onClick={() => {
                      setLabelEditing(false);
                      setLabelsToAdd("");
                      setLabelsToRemove(new Set());
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {collections.length === 0 && !search && !sectionFilter && !labelFilter ? (
          <EmptyState icon="stack" title="No collections synced yet" />
        ) : collections.length === 0 && (search || sectionFilter || labelFilter) ? (
          <>
            <div className={styles.filters}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search collections..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className={styles.select}
                value={sectionFilter}
                onChange={(e) => setSectionFilter(e.target.value)}
              >
                <option value="">All sections</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
              <select className={styles.select} value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)}>
                <option value="">All labels</option>
                {allLabels.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <EmptyState icon="search" title="No collections match your filters" />
          </>
        ) : (
          <>
            <div className={styles.filters}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search collections..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className={styles.select}
                value={sectionFilter}
                onChange={(e) => setSectionFilter(e.target.value)}
              >
                <option value="">All sections</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
              <select className={styles.select} value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)}>
                <option value="">All labels</option>
                {allLabels.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
              <div className={styles.filtersSpacer} />
              <div className={styles.viewToggle}>
                <button
                  className={`${styles.viewToggleBtn} ${viewMode === "table" ? styles.viewToggleBtnActive : ""}`}
                  onClick={() => {
                    setViewMode("table");
                    localStorage.setItem("collections-view", "table");
                  }}
                >
                  Table
                </button>
                <button
                  className={`${styles.viewToggleBtn} ${viewMode === "grid" ? styles.viewToggleBtnActive : ""}`}
                  onClick={() => {
                    setViewMode("grid");
                    localStorage.setItem("collections-view", "grid");
                  }}
                >
                  Grid
                </button>
              </div>
            </div>

            {viewMode === "grid" ? (
              <div className={styles.grid}>
                {collections.map((col) => (
                  <div
                    key={col.plexRatingKey}
                    className={styles.card}
                    onClick={() => navigate(`/collections/${col.plexRatingKey}`)}
                  >
                    {col.thumb ? (
                      <FadeImage
                        className={styles.cardPoster}
                        src={`/api/plex-image?path=${encodeURIComponent(col.thumb)}`}
                        alt={col.title}
                        loading="lazy"
                      />
                    ) : (
                      <div className={styles.cardPosterPlaceholder}>No poster</div>
                    )}
                    <div className={styles.cardTitle} title={col.title}>
                      {col.title}
                    </div>
                    <div className={styles.cardMeta}>
                      {col.childCount} item{col.childCount !== 1 ? "s" : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="table-scroll">
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.checkboxCell}>
                        <input
                          type="checkbox"
                          className={styles.checkbox}
                          checked={collections.length > 0 && selected.size === collections.length}
                          onChange={toggleSelectAll}
                        />
                      </th>
                      <th className={styles.sortable} onClick={() => toggleSort("title")}>
                        Title{sortIndicator("title")}
                      </th>
                      <th className={styles.sortable} onClick={() => toggleSort("sectionTitle")}>
                        Section{sortIndicator("sectionTitle")}
                      </th>
                      <th className={styles.sortable} onClick={() => toggleSort("childCount")}>
                        Items{sortIndicator("childCount")}
                      </th>
                      <th className={styles.sortable} onClick={() => toggleSort("smart")}>
                        Smart{sortIndicator("smart")}
                      </th>
                      <th className={styles.sortable} onClick={() => toggleSort("labels")}>
                        Labels{sortIndicator("labels")}
                      </th>
                      <th className={styles.sortable} onClick={() => toggleSort("addedAt")}>
                        Added{sortIndicator("addedAt")}
                      </th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {collections.map((col, i) => {
                      const labels = parseLabels(col.labels);
                      return (
                        <tr
                          key={col.plexRatingKey}
                          className={`${styles.clickableRow} ${selected.has(col.plexRatingKey) ? styles.selectedRow : ""}`}
                          onClick={() => navigate(`/collections/${col.plexRatingKey}`)}
                        >
                          <td
                            className={styles.checkboxCell}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCheckboxClick(i, e);
                            }}
                          >
                            <input
                              type="checkbox"
                              className={styles.checkbox}
                              checked={selected.has(col.plexRatingKey)}
                              readOnly
                            />
                          </td>
                          <td>{col.title}</td>
                          <td>{col.sectionTitle}</td>
                          <td>{col.childCount}</td>
                          <td>{col.smart ? "Yes" : "No"}</td>
                          <td>
                            {labels.map((label) => (
                              <span
                                key={label}
                                className={`${styles.label} ${["tinkerbell", "generated", "becauseyouwatched"].includes(label.toLowerCase()) ? styles.labelTinkerbell : label.toLowerCase().startsWith("user:") ? styles.labelUser : ""}`}
                              >
                                {label}
                              </span>
                            ))}
                          </td>
                          <td>{col.addedAt ? <RelativeTime timestamp={col.addedAt} seconds /> : ""}</td>
                          <td>
                            <button
                              className={`${styles.buttonDanger} ${styles.buttonSmall}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(col.plexRatingKey, col.title);
                              }}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {total > PAGE_SIZE && (
              <div className={styles.pagination}>
                <button
                  className={styles.buttonSecondary}
                  disabled={page <= 1}
                  onClick={() => setParam("page", String(page - 1))}
                >
                  Previous
                </button>
                <span className={styles.paginationInfo}>
                  Page {page} of {totalPages} ({total} items)
                </span>
                <button
                  className={styles.buttonSecondary}
                  disabled={page >= totalPages}
                  onClick={() => setParam("page", String(page + 1))}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}

        {pendingConfirm && (
          <ConfirmModal
            message={pendingConfirm.message}
            confirmLabel="Delete"
            onConfirm={pendingConfirm.onConfirm}
            onCancel={() => setPendingConfirm(null)}
          />
        )}
      </div>
    </PullToRefresh>
  );
}
