import { useState, useEffect, useMemo, Fragment } from "react";
import { useParams, useNavigate, useLocation, Link, Outlet } from "react-router-dom";
import { Image, Pin, PinOff, RefreshCw, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import { trpc } from "#/trpc";
import ConfirmModal from "#components/ConfirmModal";
import AlertModal from "#components/AlertModal";
import { DetailSkeleton } from "#components/Skeleton";
import FadeImage from "#components/FadeImage";
import PageTabs from "#components/PageTabs";
import RelativeTime from "#components/RelativeTime";
import RowActions, { type RowAction } from "#components/RowActions";
import { useToast } from "#components/Toast";
import useSwipeBack from "#hooks/useSwipeBack";
import styles from "#/styles/shared.module.css";
import { SmartFiltersDrawer } from "#components/SmartFiltersEditor";
import { CollectionProvider } from "./context.ts";
import PosterStudio from "./PosterStudio.tsx";
import local from "./CollectionDetail.module.css";

/** Labels Tinkerbell writes itself, which read as provenance rather than tags. */
const SYSTEM_LABELS = ["tinkerbell", "generated", "becauseyouwatched"];

/**
 * `Rule:<uuid>` is how a rule finds its own collections again. It is plumbing —
 * nobody typed it, removing it would quietly orphan the collection from its
 * rule, and at 43 characters it was the widest thing in the header. The rule
 * itself is already named, as a chip that links to it.
 *
 * Hidden from the row, not from the record: label edits are still sent with it
 * included, so removing a real label doesn't drop this one on the way through.
 */
const isPlumbingLabel = (label: string) => label.startsWith("Rule:");

export default function CollectionDetailLayout() {
  const { ratingKey } = useParams<{ ratingKey: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const swipeRef = useSwipeBack(navigate);
  const utils = trpc.useUtils();
  const { addToast } = useToast();

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [summaryEditing, setSummaryEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  const [filtersDrawerOpen, setFiltersDrawerOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [alert, setAlert] = useState<{ title: string; message: string } | null>(null);

  const enabled = !!ratingKey;
  const collectionQuery = trpc.collections.get.useQuery(
    { ratingKey: ratingKey! },
    { enabled, refetchOnWindowFocus: false },
  );
  const itemsQuery = trpc.collections.items.useQuery(
    { ratingKey: ratingKey! },
    { enabled, refetchOnWindowFocus: false },
  );
  const owningRuleQuery = trpc.collections.owningRule.useQuery(
    { ratingKey: ratingKey! },
    { enabled, refetchOnWindowFocus: false, staleTime: 60_000 },
  );
  // Plex is the only thing that knows whether a hub is pinned, and a rule run
  // or the Plex app itself can change it behind us — so this is never cached
  // for long and never assumed.
  const pinQuery = trpc.collections.pinState.useQuery(
    { ratingKey: ratingKey! },
    { enabled, refetchOnWindowFocus: false },
  );

  const collection = collectionQuery.data;
  const isSmart = collection?.smart === 1;

  const updateMutation = trpc.collections.update.useMutation();
  const updateLabelsMutation = trpc.collections.updateLabels.useMutation({
    onMutate: async (input) => {
      await utils.collections.get.cancel({ ratingKey: input.ratingKey });
      const prev = utils.collections.get.getData({ ratingKey: input.ratingKey });
      if (prev) utils.collections.get.setData({ ratingKey: input.ratingKey }, { ...prev, labels: input.labels });
      return { prev };
    },
    onError: (_err, input, ctx) => {
      if (ctx?.prev) utils.collections.get.setData({ ratingKey: input.ratingKey }, ctx.prev);
      addToast("Failed to update labels", "error");
    },
    onSettled: (_d, _e, input) => utils.collections.get.invalidate({ ratingKey: input.ratingKey }),
  });
  const deleteMutation = trpc.collections.delete.useMutation();
  const pinMutation = trpc.collections.pin.useMutation();
  const unpinMutation = trpc.collections.unpin.useMutation();
  const syncOneMutation = trpc.collections.syncOne.useMutation();
  const revertMutation = trpc.collections.revertArtwork.useMutation();

  useEffect(() => {
    if (collection) {
      setTitle(collection.title);
      setSummary(collection.summary || "");
    }
  }, [collection]);

  const isDirty = useMemo(() => {
    if (!collection) return false;
    return title !== collection.title || summary !== (collection.summary || "");
  }, [title, summary, collection]);

  const refresh = () => {
    if (!ratingKey) return;
    utils.collections.get.invalidate({ ratingKey });
    utils.collections.items.invalidate({ ratingKey });
    utils.collections.stats.invalidate({ ratingKey });
  };

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
          const { existedInPlex } = await deleteMutation.mutateAsync({ ratingKey });
          // Already gone from Plex: say so before leaving, since the page the
          // user is standing on is about to disappear for a reason other than
          // the one they asked for.
          if (existedInPlex) {
            navigate("/collections");
          } else {
            setAlert({
              title: "Collection no longer in Plex",
              message: `"${collection.title}" no longer exists on the Plex server — it was probably deleted there. It has been removed from Tinkerbell.`,
            });
          }
        } catch {
          addToast("Failed to delete collection", "error");
        }
      },
    });
  };

  const handleTogglePin = async () => {
    if (!ratingKey) return;
    const pinned = pinQuery.data?.pinned;
    try {
      if (pinned) {
        await unpinMutation.mutateAsync({ ratingKey });
        addToast("Unpinned from the Plex home screen", "success");
      } else {
        await pinMutation.mutateAsync({ ratingKey });
        addToast("Pinned to the Plex home screen", "success");
      }
      pinQuery.refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to change the pin", "error");
    }
  };

  const handleSyncNow = async () => {
    if (!ratingKey) return;
    try {
      await syncOneMutation.mutateAsync({ ratingKey });
      refresh();
      addToast("Re-read from Plex", "success");
    } catch {
      addToast("Failed to sync the collection", "error");
    }
  };

  const handleRevertArtwork = () => {
    if (!ratingKey) return;
    setPendingConfirm({
      message:
        "Stop Tinkerbell managing this collection's artwork? Its summary and poster will be left exactly as they are now, and no job will change them again.",
      onConfirm: async () => {
        setPendingConfirm(null);
        try {
          const { priorThumb } = await revertMutation.mutateAsync({ ratingKey });
          utils.collections.artworkState.invalidate({ ratingKey });
          // Be exact about what happened. "Reverted" would imply an image was
          // put back, and usually there is none to put back.
          setAlert({
            title: "Artwork unmanaged",
            message: priorThumb
              ? "Tinkerbell will no longer write this collection's summary or poster. The artwork it found here originally is still among the collection's posters in Plex, so you can select it from the poster picker."
              : "Tinkerbell will no longer write this collection's summary or poster. There was no earlier artwork recorded, so nothing has been changed on the collection itself.",
          });
        } catch {
          addToast("Failed to change the artwork setting", "error");
        }
      },
    });
  };

  if (collectionQuery.isLoading) return <DetailSkeleton />;
  if (collectionQuery.error || !collection) {
    return <div className={`${styles.toast} ${styles.error}`}>Collection not found</div>;
  }

  const items = itemsQuery.data ?? [];
  const labels: string[] = collection.labels ?? [];
  const base = `/collections/${ratingKey}`;
  const pinned = pinQuery.data?.pinned ?? false;
  const rotatedBy = pinQuery.data?.rotatedByRule ?? null;

  const actions: RowAction[] = [
    { label: "Change poster…", icon: Image, onSelect: () => setStudioOpen(true) },
    ...(isSmart
      ? [{ label: "Edit filters…", icon: SlidersHorizontal, onSelect: () => setFiltersDrawerOpen(true) }]
      : []),
    { label: "Sync now", icon: RefreshCw, onSelect: handleSyncNow, disabled: syncOneMutation.isPending },
    { label: "Stop managing artwork", icon: RotateCcw, onSelect: handleRevertArtwork },
    { label: "Delete collection", icon: Trash2, onSelect: handleDelete, danger: true },
  ];

  return (
    <div ref={swipeRef}>
      <a
        href="#"
        className={styles.backLink}
        onClick={(e) => {
          e.preventDefault();
          navigate("/collections");
        }}
      >
        &larr; Collections
      </a>

      <div className={local.hero}>
        <div className={local.posterFrame}>
          {collection.thumb ? (
            <FadeImage
              className={local.posterImg}
              src={`/api/plex-image?path=${encodeURIComponent(collection.thumb)}`}
              alt={collection.title}
            />
          ) : (
            <div className={local.posterEmpty}>No poster</div>
          )}
          <button type="button" className={local.posterChange} onClick={() => setStudioOpen(true)}>
            Change poster
          </button>
        </div>

        <div className={local.heroMain}>
          <div className={local.heroTop}>
            <h2 className="sr-only">{collection.title}</h2>
            <input
              className={styles.titleInput}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Collection title"
              spellCheck={false}
            />
            <div className={local.heroActions}>
              <button
                className={pinned ? styles.buttonSecondary : styles.button}
                onClick={handleTogglePin}
                disabled={pinQuery.isLoading || pinMutation.isPending || unpinMutation.isPending}
                title={
                  rotatedBy
                    ? `"${rotatedBy}" manages pinning for this collection and re-chooses on every run, so this won't last past the next one.`
                    : "Pin this collection to the Plex home screen"
                }
              >
                {pinned ? <PinOff size={13} /> : <Pin size={13} />}
                {pinned ? "Unpin" : "Pin"}
              </button>
              <RowActions actions={actions} label="Collection actions" />
            </div>
          </div>

          {/* Facts, in one quiet line. These used to be five chips of equal
              weight to the title, which is why nothing on the page read as
              primary. */}
          <div className={local.metaLine}>
            <span>{collection.sectionTitle}</span>
            <span className={local.metaDot}>·</span>
            <span>{(items.length || collection.childCount).toLocaleString()} items</span>
            {collection.addedAt && (
              <>
                <span className={local.metaDot}>·</span>
                <span>
                  added <RelativeTime timestamp={collection.addedAt} seconds />
                </span>
              </>
            )}
          </div>

          {/* Chips only for state that is genuinely categorical. */}
          {(isSmart || pinned || owningRuleQuery.data) && (
            <div className={local.badgeRow}>
              {isSmart && <span className={`${styles.metaChip} ${styles.labelTinkerbell}`}>Smart</span>}
              {pinned && <span className={styles.metaChip}>Pinned</span>}
              {owningRuleQuery.data && (
                <Link
                  to={`/rules?q=${encodeURIComponent(owningRuleQuery.data.name)}`}
                  className={`${styles.metaChip} ${styles.metaChipLink}`}
                  title="Open the rule that generates this collection"
                >
                  {owningRuleQuery.data.name}
                </Link>
              )}
            </div>
          )}

          {/* Text until clicked. A permanently-open textarea made an empty
              summary look like an unfinished form. */}
          {summaryEditing || summary ? (
            <textarea
              className={styles.summaryInput}
              value={summary}
              placeholder="Summary"
              autoFocus={summaryEditing && !summary}
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

          <div className={local.labelRow}>
            {labels
              .filter((l) => !isPlumbingLabel(l))
              .map((label) => (
                <span
                  key={label}
                  className={`${styles.label} ${
                    SYSTEM_LABELS.includes(label.toLowerCase())
                      ? styles.labelTinkerbell
                      : label.toLowerCase().startsWith("user:")
                        ? styles.labelUser
                        : ""
                  }`}
                >
                  {label}
                  <button
                    className={styles.labelRemove}
                    title={`Remove "${label}"`}
                    onClick={() => {
                      if (!ratingKey) return;
                      updateLabelsMutation.mutate({ ratingKey, labels: labels.filter((l) => l !== label) });
                    }}
                    aria-label={`Remove label ${label}`}
                  >
                    &times;
                  </button>
                </span>
              ))}
            <input
              type="text"
              className={`${styles.labelEditorInput} ${local.labelAdd}`}
              placeholder="Add label…"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const value = labelInput.trim();
                if (!value || !ratingKey) return;
                setLabelInput("");
                updateLabelsMutation.mutate({ ratingKey, labels: [...new Set([...labels, value])] });
              }}
            />
          </div>
        </div>
      </div>

      <div className={local.tabsRow}>
        <PageTabs
          tabs={[
            { to: base, label: "Items", count: items.length },
            { to: `${base}/details`, label: "Details" },
            { to: `${base}/activity`, label: "Activity" },
          ]}
          ariaLabel="Collection sections"
        />
      </div>

      <CollectionProvider
        value={{
          ratingKey: ratingKey!,
          collection,
          items,
          itemsLoading: itemsQuery.isLoading,
          isSmart,
          refresh,
          openFilters: () => setFiltersDrawerOpen(true),
        }}
      >
        {/* Keyed on the path so a tab switch remounts rather than carrying the
            previous tab's local state into a different view. */}
        <Fragment key={location.pathname}>
          <Outlet />
        </Fragment>
      </CollectionProvider>

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

      {studioOpen && (
        <PosterStudio
          ratingKey={ratingKey!}
          title={collection.title}
          memberCount={items.length}
          onClose={() => setStudioOpen(false)}
          onApplied={() => {
            setStudioOpen(false);
            refresh();
            utils.collections.artworkState.invalidate({ ratingKey: ratingKey! });
          }}
        />
      )}

      {isSmart && (
        <SmartFiltersDrawer
          open={filtersDrawerOpen}
          ratingKey={ratingKey!}
          onClose={() => setFiltersDrawerOpen(false)}
          onSaved={refresh}
        />
      )}

      {pendingConfirm && (
        <ConfirmModal
          title="Are you sure?"
          message={pendingConfirm.message}
          confirmLabel="Continue"
          danger
          onConfirm={pendingConfirm.onConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}

      {alert && (
        <AlertModal
          title={alert.title}
          message={alert.message}
          onDismiss={() => {
            const leaving = alert.title === "Collection no longer in Plex";
            setAlert(null);
            if (leaving) navigate("/collections");
          }}
        />
      )}
    </div>
  );
}
