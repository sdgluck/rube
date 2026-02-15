import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../trpc";
import styles from "./Collections.module.css";

export default function Collections() {
  const [sectionFilter, setSectionFilter] = useState("");
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const navigate = useNavigate();

  const collectionsQuery = trpc.collections.list.useQuery(
    {
      sectionId: sectionFilter || undefined,
      search: search || undefined,
    },
    { refetchOnWindowFocus: false },
  );

  const syncMutation = trpc.collections.sync.useMutation();
  const deleteMutation = trpc.collections.delete.useMutation();

  const collections = collectionsQuery.data || [];

  // Derive unique sections from the data
  const sections = [...new Map(collections.map((c) => [c.section_id, c.section_title])).entries()];

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

  const parseLabels = (labelsJson: string): string[] => {
    try {
      return JSON.parse(labelsJson);
    } catch {
      return [];
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

      {collections.length === 0 && !search && !sectionFilter ? (
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
          </div>

          <table className={styles.table}>
            <thead>
              <tr>
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
                    className={styles.clickableRow}
                    onClick={() => navigate(`/collections/${col.plex_rating_key}`)}
                  >
                    <td>{col.title}</td>
                    <td>{col.section_title}</td>
                    <td>{col.child_count}</td>
                    <td>
                      {labels.map((label) => (
                        <span
                          key={label}
                          className={`${styles.label} ${label.startsWith("tinkerbell") ? styles.labelTinkerbell : ""}`}
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
