import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import pMap from "p-map";
import { trpc } from "../trpc";
import ConfirmModal from "../ConfirmModal";
import styles from "./Collections.module.css";

type SortKey = "title" | "sectionTitle" | "childCount" | "smart" | "labels" | "addedAt";
type SortDir = "asc" | "desc";
type ViewMode = "table" | "grid";

const SORT_KEYS = new Set<string>(["title", "sectionTitle", "childCount", "smart", "labels", "addedAt"]);

export default function Collections() {
  const [searchParams, setSearchParams] = useSearchParams();

  const sectionFilter = searchParams.get("section") ?? "";
  const labelFilter = searchParams.get("label") ?? "";
  const search = searchParams.get("q") ?? "";
  const sortKey: SortKey = SORT_KEYS.has(searchParams.get("sort") ?? "")
    ? (searchParams.get("sort") as SortKey)
    : "title";
  const sortDir: SortDir = searchParams.get("dir") === "desc" ? "desc" : "asc";
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem("collections-view") as ViewMode) || "table",
  );

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
  const [status, setStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; label?: string } | null>(null);
  const [labelEditing, setLabelEditing] = useState(false);
  const [labelsToAdd, setLabelsToAdd] = useState("");
  const [labelsToRemove, setLabelsToRemove] = useState<Set<string>>(new Set());
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const collectionsQuery = trpc.collections.list.useQuery(
    {
      sectionId: sectionFilter || undefined,
      label: labelFilter || undefined,
      search: debouncedSearch || undefined,
    },
    { refetchOnWindowFocus: false, placeholderData: keepPreviousData },
  );

  // Unfiltered query for populating filter dropdowns
  const allCollectionsQuery = trpc.collections.list.useQuery({}, { refetchOnWindowFocus: false });

  const deleteMutation = trpc.collections.delete.useMutation();
  const updateLabelsMutation = trpc.collections.updateLabels.useMutation();

  const collections = collectionsQuery.data || [];

  const parseLabels = (labelsJson: string): string[] => {
    try {
      return JSON.parse(labelsJson);
    } catch {
      return [];
    }
  };

  // Derive unique sections and labels from unfiltered data
  const allCollections = allCollectionsQuery.data || [];
  const sections = [...new Map(allCollections.map((c) => [c.sectionId, c.sectionTitle])).entries()];
  const allLabels = [...new Set(allCollections.flatMap((c) => parseLabels(c.labels)))].sort();

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
        return next;
      },
      { replace: true },
    );
  };

  const sortedCollections = useMemo(() => {
    const sorted = [...collections].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
        case "sectionTitle":
          cmp = a.sectionTitle.localeCompare(b.sectionTitle);
          break;
        case "childCount":
          cmp = a.childCount - b.childCount;
          break;
        case "smart":
          cmp = (a.smart ? 1 : 0) - (b.smart ? 1 : 0);
          break;
        case "labels":
          cmp = parseLabels(a.labels).join(",").localeCompare(parseLabels(b.labels).join(","));
          break;
        case "addedAt":
          cmp = (a.addedAt ?? 0) - (b.addedAt ?? 0);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [collections, sortKey, sortDir]);

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
          setStatus({ type: "success", msg: `Deleted "${title}"` });
          collectionsQuery.refetch();
          allCollectionsQuery.refetch();
        } catch {
          setStatus({ type: "error", msg: `Failed to delete "${title}"` });
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
        setStatus(null);
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
        setStatus({
          type: failed > 0 ? "error" : "success",
          msg: failed > 0 ? `Deleted ${deleted}, failed ${failed}` : `Deleted ${deleted} collection(s)`,
        });
        collectionsQuery.refetch();
        allCollectionsQuery.refetch();
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
    setStatus(null);

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
    setStatus({
      type: failed > 0 ? "error" : "success",
      msg: failed > 0 ? `Updated ${updated}, failed ${failed}` : `Updated labels on ${updated} collection(s)`,
    });
    collectionsQuery.refetch();
    allCollectionsQuery.refetch();
  };

  const toggleSelect = (ratingKey: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ratingKey)) {
        next.delete(ratingKey);
      } else {
        next.add(ratingKey);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === collections.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(collections.map((c) => c.plexRatingKey)));
    }
  };

  if (collectionsQuery.isLoading) return <p>Loading...</p>;
  if (collectionsQuery.error)
    return <div className={`${styles.toast} ${styles.error}`}>Failed to load collections</div>;

  return (
    <div>
      <h2 className={styles.heading}>
        Collections{collections.length > 0 && <span className="count-badge">{collections.length}</span>}
      </h2>

      {status && <div className={`${styles.toast} ${styles[status.type]}`}>{status.msg}</div>}

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
        <div className={styles.emptyState}>
          <p>No collections synced yet.</p>
        </div>
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
            <select className={styles.select} value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}>
              <option value="">All sections</option>
              {sections.map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
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
              {sortedCollections.map((col) => (
                <div
                  key={col.plexRatingKey}
                  className={styles.card}
                  onClick={() => navigate(`/collections/${col.plexRatingKey}`)}
                >
                  {col.thumb ? (
                    <img
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
                {sortedCollections.map((col) => {
                  const labels = parseLabels(col.labels);
                  return (
                    <tr
                      key={col.plexRatingKey}
                      className={`${styles.clickableRow} ${selected.has(col.plexRatingKey) ? styles.selectedRow : ""}`}
                      onClick={() => navigate(`/collections/${col.plexRatingKey}`)}
                    >
                      <td className={styles.checkboxCell} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className={styles.checkbox}
                          checked={selected.has(col.plexRatingKey)}
                          onChange={() => toggleSelect(col.plexRatingKey)}
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
                      <td>{col.addedAt ? new Date(col.addedAt * 1000).toLocaleDateString() : ""}</td>
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
  );
}
