import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../trpc";
import styles from "./Collections.module.css";

export default function Collections() {
  const [sectionFilter, setSectionFilter] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
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
    { refetchOnWindowFocus: false },
  );

  const syncMutation = trpc.collections.sync.useMutation();
  const deleteMutation = trpc.collections.delete.useMutation();

  const collections = collectionsQuery.data || [];

  const parseLabels = (labelsJson: string): string[] => {
    try {
      return JSON.parse(labelsJson);
    } catch {
      return [];
    }
  };

  // Derive unique sections and labels from the data
  const sections = [...new Map(collections.map((c) => [c.section_id, c.section_title])).entries()];
  const allLabels = [...new Set(collections.flatMap((c) => parseLabels(c.labels)))].sort();

  // Clear selection when filters change
  useEffect(() => {
    setSelected(new Set());
  }, [sectionFilter, labelFilter, debouncedSearch]);

  const handleSync = async () => {
    setSyncing(true);
    setStatus(null);
    try {
      const stats = await syncMutation.mutateAsync();
      setStatus({ type: "success", msg: `Synced ${stats.synced} collection(s), removed ${stats.removed} stale.` });
      collectionsQuery.refetch();
    } catch {
      setStatus({ type: "error", msg: "Sync failed" });
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async (ratingKey: string, title: string) => {
    if (!confirm(`Delete "${title}"? This will remove it from Plex.`)) return;
    try {
      await deleteMutation.mutateAsync({ ratingKey });
      setStatus({ type: "success", msg: `Deleted "${title}"` });
      collectionsQuery.refetch();
    } catch {
      setStatus({ type: "error", msg: `Failed to delete "${title}"` });
    }
  };

  const handleBulkDelete = async () => {
    const count = selected.size;
    if (!confirm(`Delete ${count} collection(s)? This will remove them from Plex.`)) return;
    setBulkProgress({ done: 0, total: count });
    setStatus(null);
    let deleted = 0;
    let failed = 0;
    for (const ratingKey of selected) {
      try {
        await deleteMutation.mutateAsync({ ratingKey });
        deleted++;
      } catch {
        failed++;
      }
      setBulkProgress({ done: deleted + failed, total: count });
    }
    setSelected(new Set());
    setBulkProgress(null);
    setStatus({
      type: failed > 0 ? "error" : "success",
      msg: failed > 0 ? `Deleted ${deleted}, failed ${failed}` : `Deleted ${deleted} collection(s)`,
    });
    collectionsQuery.refetch();
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
      setSelected(new Set(collections.map((c) => c.plex_rating_key)));
    }
  };

  if (collectionsQuery.isLoading) return <p>Loading...</p>;
  if (collectionsQuery.error)
    return <div className={`${styles.toast} ${styles.error}`}>Failed to load collections</div>;

  return (
    <div>
      <div className={styles.header}>
        <h2 className={styles.heading}>Collections</h2>
        <div className={styles.headerActions}>
          <button className={styles.button} onClick={handleSync} disabled={syncing}>
            {syncing ? "Syncing..." : "Sync Now"}
          </button>
        </div>
      </div>

      {status && <div className={`${styles.toast} ${styles[status.type]}`}>{status.msg}</div>}

      {(selected.size > 0 || bulkProgress) && (
        <div className={styles.bulkBar}>
          {bulkProgress ? (
            <>
              <span className={styles.bulkCount}>
                Deleting {bulkProgress.done}/{bulkProgress.total}...
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
              <button className={`${styles.buttonDanger} ${styles.buttonSmall}`} onClick={handleBulkDelete}>
                Delete {selected.size}
              </button>
              <button
                className={`${styles.buttonSmall} ${styles.buttonSecondary}`}
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}

      {collections.length === 0 && !search && !sectionFilter && !labelFilter ? (
        <div className={styles.emptyState}>
          <p>No collections synced yet.</p>
          <p className={styles.hint}>Click "Sync Now" to pull collections from Plex.</p>
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
          </div>

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
                <th>Title</th>
                <th>Section</th>
                <th>Items</th>
                <th>Labels</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {collections.map((col) => {
                const labels = parseLabels(col.labels);
                return (
                  <tr
                    key={col.plex_rating_key}
                    className={`${styles.clickableRow} ${selected.has(col.plex_rating_key) ? styles.selectedRow : ""}`}
                    onClick={() => navigate(`/collections/${col.plex_rating_key}`)}
                  >
                    <td className={styles.checkboxCell} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className={styles.checkbox}
                        checked={selected.has(col.plex_rating_key)}
                        onChange={() => toggleSelect(col.plex_rating_key)}
                      />
                    </td>
                    <td>{col.title}</td>
                    <td>{col.section_title}</td>
                    <td>{col.child_count}</td>
                    <td>
                      {labels.map((label) => (
                        <span
                          key={label}
                          className={`${styles.label} ${["tinkerbell", "generated", "becauseyouwatched"].includes(label.toLowerCase()) ? styles.labelTinkerbell : ""}`}
                        >
                          {label}
                        </span>
                      ))}
                    </td>
                    <td>{col.added_at ? new Date(col.added_at * 1000).toLocaleDateString() : ""}</td>
                    <td>
                      <button
                        className={`${styles.buttonDanger} ${styles.buttonSmall}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(col.plex_rating_key, col.title);
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
        </>
      )}
    </div>
  );
}
