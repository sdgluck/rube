import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { EMPTY } from "#/format";
import { trpc } from "#/trpc";
import SortableTh from "#components/SortableTh";
import { useLocalSort } from "#hooks/useLocalSort";
import BulkBar from "#components/BulkBar";
import EmptyState from "#components/EmptyState";
import FadeImage from "#components/FadeImage";
import SearchInput from "#components/SearchInput";
import { useToast } from "#components/Toast";
import ConfirmModal from "#components/ConfirmModal";
import { readEnumStorage, writeStorage } from "#/storage";
import styles from "#/styles/shared.module.css";
import { useCollection } from "./context.ts";
import AddItemsModal from "./AddItemsModal.tsx";
import local from "./CollectionDetail.module.css";
import { plexImageUrl } from "#lib/media";

const VIEW_MODES = ["table", "grid"] as const;
type ViewMode = (typeof VIEW_MODES)[number];

export default function Items() {
  const navigate = useNavigate();
  const { ratingKey, collection, items, itemsLoading, isSmart, refresh, openFilters } = useCollection();
  const { addToast } = useToast();

  const [view, setView] = useState<ViewMode>(() => readEnumStorage("collection-items-view", VIEW_MODES, "grid"));
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const lastClickedIndex = useRef<number | null>(null);

  const removeMutation = trpc.collections.removeItems.useMutation();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.title.toLowerCase().includes(q));
  }, [items, search]);

  // A selection that survives a filter change is a selection nobody can see.
  useEffect(() => {
    setSelected(new Set());
    lastClickedIndex.current = null;
  }, [search]);

  const { sortKey, sortDir, toggleSort, sorted } = useLocalSort({
    rows: filtered,
    accessors: { title: (i) => i.title, year: (i) => i.year },
    defaultKey: "title",
    descFirst: ["year"],
  });

  const setViewPersisted = (mode: ViewMode) => {
    setView(mode);
    writeStorage("collection-items-view", mode);
  };

  const handleCheckboxClick = (index: number, e: React.MouseEvent) => {
    const key = sorted[index].ratingKey;
    if (e.shiftKey && lastClickedIndex.current != null) {
      const from = Math.min(lastClickedIndex.current, index);
      const to = Math.max(lastClickedIndex.current, index);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) next.add(sorted[i].ratingKey);
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
    setSelected(selected.size === sorted.length ? new Set() : new Set(sorted.map((i) => i.ratingKey)));
  };

  const handleRemove = async () => {
    setConfirmRemove(false);
    setRemoving(true);
    try {
      // One request, not one per item: the server walks them and reports how
      // many were actually there, which can be fewer than were asked for.
      const { removed } = await removeMutation.mutateAsync({
        ratingKey,
        itemRatingKeys: [...selected],
      });
      setSelected(new Set());
      refresh();
      addToast(`Removed ${removed} item${removed === 1 ? "" : "s"}`, "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to remove items", "error");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          noun="item"
          actions={[
            {
              label: "Remove from collection",
              tone: "danger",
              onClick: () => setConfirmRemove(true),
              disabled: removing,
            },
          ]}
          onClear={() => setSelected(new Set())}
          progress={removing ? { done: 0, total: selected.size, label: "Removing" } : null}
        />
      )}

      <div className={local.toolbar}>
        <span className={styles.itemsToolbarTitle}>
          {filtered.length}
          {filtered.length !== items.length ? ` of ${items.length}` : ""} item{items.length === 1 ? "" : "s"}
        </span>
        <span className={local.toolbarSpacer} />
        <SearchInput placeholder="Search items…" value={search} onChange={setSearch} />
        {/* A smart collection's membership is its filter — an "Add items"
            button there would be a control that can't do what it says. */}
        {!isSmart && (
          <button className={styles.buttonSecondary} onClick={() => setAddOpen(true)}>
            Add items
          </button>
        )}
        <div className={styles.viewToggle}>
          <button
            className={`${styles.viewToggleBtn} ${view === "table" ? styles.viewToggleBtnActive : ""}`}
            onClick={() => setViewPersisted("table")}
          >
            Table
          </button>
          <button
            className={`${styles.viewToggleBtn} ${view === "grid" ? styles.viewToggleBtnActive : ""}`}
            onClick={() => setViewPersisted("grid")}
          >
            Grid
          </button>
        </div>
      </div>

      {itemsLoading ? (
        <p className={styles.hint}>Loading items…</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon="film"
          title="No items in this collection"
          description={isSmart ? "Nothing matches its filter right now." : undefined}
          action={
            isSmart ? (
              <button className={styles.buttonSecondary} onClick={openFilters}>
                Edit filters
              </button>
            ) : (
              <button className={styles.button} onClick={() => setAddOpen(true)}>
                Add items
              </button>
            )
          }
        />
      ) : filtered.length === 0 ? (
        <p className={styles.hint}>No items match "{search}".</p>
      ) : view === "grid" ? (
        <div className={styles.gridDense}>
          {sorted.map((item) => (
            <div
              key={item.ratingKey}
              className={styles.cardDense}
              onClick={() => navigate(`/media/${item.ratingKey}`)}
              tabIndex={0}
              role="button"
              aria-label={item.title}
            >
              {item.thumb ? (
                <FadeImage
                  className={styles.cardPoster}
                  src={plexImageUrl(item.thumb)}
                  alt={item.title}
                  loading="lazy"
                />
              ) : (
                <div className={styles.cardPosterPlaceholder}>No poster</div>
              )}
              <div className={styles.cardOverlay}>
                <div className={styles.cardOverlayTitle}>{item.title}</div>
                {item.year && <div className={styles.cardOverlayMeta}>{item.year}</div>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="table-scroll in-panel">
          <table className={styles.table}>
            <thead>
              <tr>
                {!isSmart && (
                  <th className={styles.checkboxCell}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={selected.size > 0 && selected.size === sorted.length}
                      onChange={toggleSelectAll}
                      aria-label="Select all items"
                    />
                  </th>
                )}
                <SortableTh sortKey="title" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Title
                </SortableTh>
                <SortableTh sortKey="year" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                  Year
                </SortableTh>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item, i) => (
                <tr
                  key={item.ratingKey}
                  className={`${styles.clickableRow} ${selected.has(item.ratingKey) ? styles.selectedRow : ""}`}
                  onClick={() => navigate(`/media/${item.ratingKey}`)}
                >
                  {!isSmart && (
                    <td className={styles.checkboxCell} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className={styles.checkbox}
                        checked={selected.has(item.ratingKey)}
                        onChange={() => {}}
                        onClick={(e) => handleCheckboxClick(i, e)}
                        aria-label={`Select ${item.title}`}
                      />
                    </td>
                  )}
                  <td data-cell="title">{item.title}</td>
                  <td data-cell="meta" className={styles.itemYear}>
                    {item.year || EMPTY}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && (
        <AddItemsModal
          ratingKey={ratingKey}
          sectionId={collection.sectionId}
          existing={new Set(items.map((i) => i.ratingKey))}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            setAddOpen(false);
            refresh();
          }}
        />
      )}

      {confirmRemove && (
        <ConfirmModal
          title="Remove from collection?"
          message={`Remove ${selected.size} item${selected.size === 1 ? "" : "s"} from "${collection.title}"? The ${selected.size === 1 ? "file stays" : "files stay"} in your library — only the collection changes.`}
          confirmLabel="Remove"
          danger
          onConfirm={handleRemove}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </>
  );
}
