import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { trpc } from "#/trpc";
import ConfirmModal from "#components/ConfirmModal";
import { DetailSkeleton } from "#components/Skeleton";
import EmptyState from "#components/EmptyState";
import FadeImage from "#components/FadeImage";
import RelativeTime from "#components/RelativeTime";
import { useToast } from "#components/Toast";
import useSwipeBack from "#hooks/useSwipeBack";
import { readEnumStorage } from "#/storage";
import styles from "./Collections.module.css";
import SmartFiltersEditor, { type SmartFiltersEditorHandle } from "#components/SmartFiltersEditor";

const VIEW_MODES = ["table", "grid"] as const;
type ViewMode = (typeof VIEW_MODES)[number];

export default function CollectionDetail() {
  const { ratingKey } = useParams<{ ratingKey: string }>();
  const navigate = useNavigate();
  const swipeRef = useSwipeBack(navigate);
  const utils = trpc.useUtils();

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  const [filtersDirty, setFiltersDirty] = useState(false);
  const [itemsView, setItemsView] = useState<ViewMode>(() =>
    readEnumStorage("collection-items-view", VIEW_MODES, "table"),
  );
  const { addToast } = useToast();
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const filtersRef = useRef<SmartFiltersEditorHandle | null>(null);

  const collectionQuery = trpc.collections.get.useQuery(
    { ratingKey: ratingKey! },
    { enabled: !!ratingKey, refetchOnWindowFocus: false },
  );

  const itemsQuery = trpc.collections.items.useQuery(
    { ratingKey: ratingKey! },
    { enabled: !!ratingKey, refetchOnWindowFocus: false },
  );

  const owningRuleQuery = trpc.collections.owningRule.useQuery(
    { ratingKey: ratingKey! },
    { enabled: !!ratingKey, refetchOnWindowFocus: false, staleTime: 60_000 },
  );

  const updateMutation = trpc.collections.update.useMutation();
  const updateLabelsMutation = trpc.collections.updateLabels.useMutation({
    onMutate: async (input) => {
      await utils.collections.get.cancel({ ratingKey: input.ratingKey });
      const prev = utils.collections.get.getData({ ratingKey: input.ratingKey });
      if (prev) {
        utils.collections.get.setData({ ratingKey: input.ratingKey }, { ...prev, labels: input.labels });
      }
      return { prev };
    },
    onError: (_err, input, ctx) => {
      if (ctx?.prev) {
        utils.collections.get.setData({ ratingKey: input.ratingKey }, ctx.prev);
      }
      addToast("Failed to update labels", "error");
    },
    onSettled: (_data, _err, input) => {
      utils.collections.get.invalidate({ ratingKey: input.ratingKey });
    },
  });
  const deleteMutation = trpc.collections.delete.useMutation();

  const collection = collectionQuery.data;
  const items = itemsQuery.data || [];

  useEffect(() => {
    if (collection) {
      setTitle(collection.title);
      setSummary(collection.summary);
      setSummaryOpen(!!collection.summary);
    }
  }, [collection]);

  const headerDirty = useMemo(() => {
    if (!collection) return false;
    return title !== collection.title || summary !== (collection.summary || "");
  }, [title, summary, collection]);

  const isDirty = headerDirty || filtersDirty;

  const handleSave = async () => {
    if (!ratingKey || !isDirty) return;
    setSaving(true);
    try {
      const tasks: Promise<unknown>[] = [];
      if (headerDirty) tasks.push(updateMutation.mutateAsync({ ratingKey, title, summary }));
      if (filtersDirty && filtersRef.current) tasks.push(filtersRef.current.save());
      await Promise.all(tasks);
      addToast("Collection updated", "success");
      collectionQuery.refetch();
      itemsQuery.refetch();
    } catch {
      addToast("Failed to update collection", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!ratingKey || !collection) return;
    setPendingConfirm({
      message: `Delete "${collection.title}"? This will remove it from Plex.`,
      onConfirm: async () => {
        setPendingConfirm(null);
        try {
          await deleteMutation.mutateAsync({ ratingKey });
          navigate("/collections");
        } catch {
          addToast("Failed to delete collection", "error");
        }
      },
    });
  };

  if (collectionQuery.isLoading) return <DetailSkeleton />;
  if (collectionQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Collection not found</div>;
  if (!collection) return null;

  const labels: string[] = collection.labels ?? [];

  return (
    <div ref={swipeRef}>
      <a
        href="#"
        className={styles.backLink}
        onClick={(e) => {
          e.preventDefault();
          navigate(-1);
        }}
      >
        &larr; Collections
      </a>

      <div className={styles.detailLayout}>
        <div className={styles.detailPoster}>
          {collection.thumb ? (
            <FadeImage
              className={styles.detailPosterImg}
              src={`/api/plex-image?path=${encodeURIComponent(collection.thumb)}`}
              alt={collection.title}
            />
          ) : (
            <div className={styles.detailPosterPlaceholder}>No poster</div>
          )}
        </div>

        <div className={styles.detailMain}>
          <div className={styles.detailHeader}>
            <input
              className={styles.titleInput}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Collection title"
              spellCheck={false}
            />
            <div className={styles.detailHeaderActions}>
              <button
                className={styles.button}
                onClick={handleSave}
                disabled={!isDirty || saving}
                title={isDirty ? "Save changes" : "No changes to save"}
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button className={styles.buttonDanger} onClick={handleDelete}>
                Delete
              </button>
            </div>
          </div>

          <div className={styles.meta}>
            <span className={styles.metaChip}>{collection.sectionTitle}</span>
            <span className={styles.metaChip}>{collection.childCount} items</span>
            {collection.addedAt && (
              <span className={styles.metaChip}>
                Added <RelativeTime timestamp={collection.addedAt} seconds />
              </span>
            )}
            {collection.smart === 1 && <span className={`${styles.metaChip} ${styles.labelTinkerbell}`}>Smart</span>}
            {owningRuleQuery.data && (
              <Link
                to={`/rules?focus=${owningRuleQuery.data.id}`}
                className={`${styles.metaChip} ${styles.metaChipLink}`}
                title="Open generating rule"
              >
                Rule: {owningRuleQuery.data.name}
              </Link>
            )}
          </div>

          <div className={styles.detailLabels}>
            {labels.map((label) => (
              <span
                key={label}
                className={`${styles.label} ${["tinkerbell", "generated", "becauseyouwatched"].includes(label.toLowerCase()) ? styles.labelTinkerbell : label.toLowerCase().startsWith("user:") ? styles.labelUser : ""}`}
              >
                {label}
                <button
                  className={styles.labelRemove}
                  title={`Remove "${label}"`}
                  onClick={() => {
                    if (!ratingKey) return;
                    updateLabelsMutation.mutate({
                      ratingKey,
                      labels: labels.filter((l) => l !== label),
                    });
                  }}
                >
                  &times;
                </button>
              </span>
            ))}
            <input
              type="text"
              className={styles.labelEditorInput}
              placeholder="Add label..."
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const value = labelInput.trim();
                  if (!value || !ratingKey) return;
                  setLabelInput("");
                  updateLabelsMutation.mutate({
                    ratingKey,
                    labels: [...new Set([...labels, value])],
                  });
                }
              }}
            />
          </div>

          {summaryOpen ? (
            <textarea
              className={styles.summaryInput}
              value={summary}
              placeholder="Summary"
              onChange={(e) => setSummary(e.target.value)}
              onBlur={() => {
                if (!summary.trim()) setSummaryOpen(false);
              }}
            />
          ) : (
            <button type="button" className={styles.summaryAdd} onClick={() => setSummaryOpen(true)}>
              + Add summary
            </button>
          )}

          {collection.smart === 1 && (
            <SmartFiltersEditor
              ref={filtersRef}
              ratingKey={ratingKey!}
              onSaved={() => itemsQuery.refetch()}
              onDirtyChange={setFiltersDirty}
            />
          )}
        </div>
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>
          <span>Items ({items.length})</span>
          <div className={styles.viewToggle}>
            <button
              className={`${styles.viewToggleBtn} ${itemsView === "table" ? styles.viewToggleBtnActive : ""}`}
              onClick={() => {
                setItemsView("table");
                localStorage.setItem("collection-items-view", "table");
              }}
            >
              Table
            </button>
            <button
              className={`${styles.viewToggleBtn} ${itemsView === "grid" ? styles.viewToggleBtnActive : ""}`}
              onClick={() => {
                setItemsView("grid");
                localStorage.setItem("collection-items-view", "grid");
              }}
            >
              Grid
            </button>
          </div>
        </div>
        {itemsQuery.isLoading ? (
          <p className={styles.hint}>Loading items...</p>
        ) : items.length === 0 ? (
          <EmptyState icon="film" title="No items in this collection" />
        ) : itemsView === "grid" ? (
          <div className={styles.grid}>
            {items.map((item) => (
              <div key={item.ratingKey} className={styles.card}>
                {item.thumb ? (
                  <FadeImage
                    className={styles.cardPoster}
                    src={`/api/plex-image?path=${encodeURIComponent(item.thumb)}`}
                    alt={item.title}
                    loading="lazy"
                  />
                ) : (
                  <div className={styles.cardPosterPlaceholder}>No poster</div>
                )}
                <div className={styles.cardTitle} title={item.title}>
                  {item.title}
                </div>
                {item.year && <div className={styles.cardMeta}>{item.year}</div>}
              </div>
            ))}
          </div>
        ) : (
          <div className="table-scroll">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Year</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.ratingKey}>
                    <td>{item.title}</td>
                    <td className={styles.itemYear}>{item.year || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
