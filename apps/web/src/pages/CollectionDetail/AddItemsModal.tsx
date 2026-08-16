import { useState, useMemo } from "react";
import { trpc } from "#/trpc";
import Modal from "#components/Modal";
import SearchInput from "#components/SearchInput";
import { useToast } from "#components/Toast";
import { useDebouncedValue } from "#hooks/useDebouncedValue";
import styles from "#/styles/shared.module.css";
import local from "./CollectionDetail.module.css";

/** Enough to choose from without turning the picker into a second Media page. */
const RESULT_LIMIT = 50;

/**
 * Adding items by searching the local media mirror.
 *
 * Scoped to the collection's own library: a collection belongs to one section,
 * and Plex would reject a member from another one — better to never offer it
 * than to explain the failure afterwards.
 */
export default function AddItemsModal({
  ratingKey,
  sectionId,
  existing,
  onClose,
  onAdded,
}: {
  ratingKey: string;
  sectionId: string;
  /** Already in the collection — shown as such rather than hidden, so a search that finds nothing new says why. */
  existing: Set<string>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { addToast } = useToast();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 250);

  const mediaQuery = trpc.media.list.useQuery(
    { sectionIds: [sectionId], search: debouncedSearch || undefined, limit: RESULT_LIMIT, offset: 0 },
    { refetchOnWindowFocus: false },
  );
  const addMutation = trpc.collections.addItems.useMutation();

  const results = useMemo(() => mediaQuery.data?.items ?? [], [mediaQuery.data]);

  const toggle = (key: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleAdd = async () => {
    if (picked.size === 0) return;
    setSaving(true);
    try {
      await addMutation.mutateAsync({ ratingKey, itemRatingKeys: [...picked] });
      addToast(`Added ${picked.size} item${picked.size === 1 ? "" : "s"}`, "success");
      onAdded();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to add items", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add items"
      meta={picked.size > 0 ? `${picked.size} selected` : undefined}
      size="md"
      footer={
        <>
          <button className={styles.buttonSecondary} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className={styles.button} onClick={handleAdd} disabled={picked.size === 0 || saving}>
            {saving ? "Adding…" : `Add ${picked.size || ""}`.trim()}
          </button>
        </>
      }
    >
      <SearchInput placeholder="Search this library…" value={search} onChange={setSearch} grow />

      {mediaQuery.isLoading ? (
        <p className={styles.hint}>Searching…</p>
      ) : results.length === 0 ? (
        <p className={styles.hint}>
          {debouncedSearch ? `Nothing in this library matches "${debouncedSearch}".` : "This library has no items yet."}
        </p>
      ) : (
        <div className={local.pickList}>
          {results.map((item) => {
            const already = existing.has(item.ratingKey);
            return (
              <label key={item.ratingKey} className={local.pickItem}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={already || picked.has(item.ratingKey)}
                  disabled={already}
                  onChange={() => toggle(item.ratingKey)}
                />
                {item.thumb && (
                  <img
                    className={local.pickThumb}
                    src={`/api/plex-image?path=${encodeURIComponent(item.thumb)}`}
                    alt=""
                    loading="lazy"
                  />
                )}
                <span>{item.title}</span>
                <span className={local.pickYear}>{already ? "Already in" : item.year}</span>
              </label>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
