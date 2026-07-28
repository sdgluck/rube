import { useState, useEffect, useMemo } from "react";
import { EMPTY } from "#/format";
import { useParams, useNavigate, Link } from "react-router-dom";
import { trpc } from "#/trpc";
import ConfirmModal from "#components/ConfirmModal";
import { DetailSkeleton } from "#components/Skeleton";
import EmptyState from "#components/EmptyState";
import FadeImage from "#components/FadeImage";
import RelativeTime from "#components/RelativeTime";
import { useToast } from "#components/Toast";
import useSwipeBack from "#hooks/useSwipeBack";
import { readEnumStorage, writeStorage } from "#/storage";
import styles from "#/styles/shared.module.css";
import { SmartFiltersDrawer, SmartFilterSummary } from "#components/SmartFiltersEditor";

const VIEW_MODES = ["table", "grid"] as const;
type ViewMode = (typeof VIEW_MODES)[number];

export default function CollectionDetail() {
  const { ratingKey } = useParams<{ ratingKey: string }>();
  const navigate = useNavigate();
  const swipeRef = useSwipeBack(navigate);
  const utils = trpc.useUtils();

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [summaryEditing, setSummaryEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  const [filtersDrawerOpen, setFiltersDrawerOpen] = useState(false);
  const [itemsView, setItemsView] = useState<ViewMode>(() =>
    readEnumStorage("collection-items-view", VIEW_MODES, "grid"),
  );
  const [itemSearch, setItemSearch] = useState("");
  const { addToast } = useToast();
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);

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

  const collection = collectionQuery.data;
  const isSmart = collection?.smart === 1;

  const smartConfigQuery = trpc.collections.smartConfig.useQuery(
    { ratingKey: ratingKey! },
    { enabled: !!ratingKey && isSmart, refetchOnWindowFocus: false },
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

  const items = itemsQuery.data || [];

  useEffect(() => {
    if (collection) {
      setTitle(collection.title);
      setSummary(collection.summary || "");
    }
  }, [collection]);

  const headerDirty = useMemo(() => {
    if (!collection) return false;
    return title !== collection.title || summary !== (collection.summary || "");
  }, [title, summary, collection]);

  const isDirty = headerDirty;

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.title.toLowerCase().includes(q));
  }, [items, itemSearch]);

  const handleSave = async () => {
    if (!ratingKey || !isDirty) return;
    setSaving(true);
    try {
      await updateMutation.mutateAsync({ ratingKey, title, summary });
      addToast("Collection updated", "success");
      collectionQuery.refetch();
    } catch {
      addToast("Failed to update collection", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!collection) return;
    setTitle(collection.title);
    setSummary(collection.summary || "");
    setSummaryEditing(false);
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

  const setItemsViewPersisted = (mode: ViewMode) => {
    setItemsView(mode);
    writeStorage("collection-items-view", mode);
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
            <h2 className="sr-only">{collection.title}</h2>
            <input
              className={styles.titleInput}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Collection title"
              spellCheck={false}
            />
            <div className={styles.detailHeaderActions}>
              <button className={styles.buttonDanger} onClick={handleDelete}>
                Delete
              </button>
            </div>
          </div>

          <div className={styles.detailMetaRow}>
            <span className={styles.metaChip}>{collection.sectionTitle}</span>
            <span className={styles.metaChip}>
              {(itemsQuery.data ? itemsQuery.data.length : collection.childCount).toLocaleString()} items
            </span>
            {collection.addedAt && (
              <span className={styles.metaChip}>
                Added <RelativeTime timestamp={collection.addedAt} seconds />
              </span>
            )}
            {isSmart && <span className={`${styles.metaChip} ${styles.labelTinkerbell}`}>Smart</span>}
            {owningRuleQuery.data && (
              <Link
                to={`/rules?focus=${owningRuleQuery.data.id}`}
                className={`${styles.metaChip} ${styles.metaChipLink}`}
                title="Open generating rule"
              >
                Rule: {owningRuleQuery.data.name}
              </Link>
            )}
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
                  aria-label={`Remove label ${label}`}
                >
                  &times;
                </button>
              </span>
            ))}
            <input
              type="text"
              className={styles.labelEditorInput}
              placeholder="Add label…"
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

          <div className={styles.summaryRow}>
            {summaryEditing || summary ? (
              <textarea
                className={styles.summaryInput}
                value={summary}
                placeholder="Summary"
                onChange={(e) => setSummary(e.target.value)}
                onFocus={() => setSummaryEditing(true)}
                onBlur={() => {
                  if (!summary.trim()) setSummaryEditing(false);
                }}
              />
            ) : (
              <button type="button" className={styles.summaryAdd} onClick={() => setSummaryEditing(true)}>
                + Add summary
              </button>
            )}
          </div>

          {isSmart && smartConfigQuery.data?.content && (
            <SmartFilterSummary content={smartConfigQuery.data.content} onEdit={() => setFiltersDrawerOpen(true)} />
          )}
        </div>
      </div>

      <div className={styles.detailSection}>
        <div className={styles.itemsToolbar}>
          <span className={styles.itemsToolbarTitle}>
            Items ({filteredItems.length}
            {filteredItems.length !== items.length ? ` of ${items.length}` : ""})
          </span>
          <span className={styles.itemsToolbarSpacer} />
          <input
            type="text"
            className={styles.itemSearch}
            placeholder="Search items…"
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
          />
          <div className={styles.viewToggle}>
            <button
              className={`${styles.viewToggleBtn} ${itemsView === "table" ? styles.viewToggleBtnActive : ""}`}
              onClick={() => setItemsViewPersisted("table")}
            >
              Table
            </button>
            <button
              className={`${styles.viewToggleBtn} ${itemsView === "grid" ? styles.viewToggleBtnActive : ""}`}
              onClick={() => setItemsViewPersisted("grid")}
            >
              Grid
            </button>
          </div>
        </div>
        {itemsQuery.isLoading ? (
          <p className={styles.hint}>Loading items…</p>
        ) : items.length === 0 ? (
          <EmptyState icon="film" title="No items in this collection" />
        ) : filteredItems.length === 0 ? (
          <p className={styles.hint}>No items match "{itemSearch}".</p>
        ) : itemsView === "grid" ? (
          <div className={styles.gridDense}>
            {filteredItems.map((item) => (
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
                    src={`/api/plex-image?path=${encodeURIComponent(item.thumb)}`}
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
          <div className="table-scroll">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Year</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr
                    key={item.ratingKey}
                    className={styles.clickableRow}
                    onClick={() => navigate(`/media/${item.ratingKey}`)}
                  >
                    <td>{item.title}</td>
                    <td className={styles.itemYear}>{item.year || EMPTY}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isDirty && (
        <div className={styles.stickySaveBar}>
          <span className={styles.stickySaveLabel}>Unsaved changes</span>
          <button className={styles.buttonSecondary} onClick={handleDiscard} disabled={saving}>
            Discard
          </button>
          <button className={styles.button} onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {isSmart && (
        <SmartFiltersDrawer
          open={filtersDrawerOpen}
          ratingKey={ratingKey!}
          onClose={() => setFiltersDrawerOpen(false)}
          onSaved={() => {
            itemsQuery.refetch();
            smartConfigQuery.refetch();
          }}
        />
      )}

      {pendingConfirm && (
        <ConfirmModal
          title="Delete collection?"
          message={pendingConfirm.message}
          confirmLabel="Delete"
          danger
          onConfirm={pendingConfirm.onConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  );
}
