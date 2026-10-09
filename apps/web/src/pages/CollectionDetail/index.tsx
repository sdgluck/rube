import { useState, Fragment } from "react";
import { useParams, useNavigate, useLocation, Link, Outlet } from "react-router-dom";
import { Image, Pencil, Pin, PinOff, RefreshCw, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import { trpc } from "#/trpc";
import ConfirmModal from "#components/ConfirmModal";
import { DetailSkeleton } from "#components/Skeleton";
import FadeImage from "#components/FadeImage";
import PageTabs from "#components/PageTabs";
import RelativeTime from "#components/RelativeTime";
import RowActions, { type RowAction } from "#components/RowActions";
import { useToast } from "#components/Toast";
import styles from "#/styles/shared.module.css";
import { SmartFiltersDrawer } from "#components/SmartFiltersEditor";
import { PageCrumbs } from "#layout/AppBar";
import { CollectionProvider } from "./context.ts";
import CollectionEditModal from "./CollectionEditModal.tsx";
import PosterStudio from "./PosterStudio.tsx";
import local from "./CollectionDetail.module.css";
import { plexImageUrl } from "#lib/media";

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
  const utils = trpc.useUtils();
  const { addToast } = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [filtersDrawerOpen, setFiltersDrawerOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);

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

  const deleteMutation = trpc.collections.delete.useMutation();
  const pinMutation = trpc.collections.pin.useMutation();
  const unpinMutation = trpc.collections.unpin.useMutation();
  const syncOneMutation = trpc.collections.syncOne.useMutation();
  const revertMutation = trpc.collections.revertArtwork.useMutation();

  const refresh = () => {
    if (!ratingKey) return;
    utils.collections.get.invalidate({ ratingKey });
    utils.collections.items.invalidate({ ratingKey });
    utils.collections.stats.invalidate({ ratingKey });
  };

  const handleDelete = () => {
    if (!ratingKey || !collection) return;
    setPendingConfirm({
      message: `Delete "${collection.title}"? This will remove it from Plex.`,
      onConfirm: async () => {
        setPendingConfirm(null);
        try {
          const { existedInPlex } = await deleteMutation.mutateAsync({ ratingKey });
          // Already gone from Plex: the toast says so, since the page the
          // user is standing on disappears for a reason other than the one
          // they asked for.
          if (!existedInPlex) {
            addToast(`"${collection.title}" was already gone from Plex — removed here too`, "info");
          }
          navigate("/collections");
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
      message: "Stop managing this collection's artwork? No job will change its poster or summary again.",
      onConfirm: async () => {
        setPendingConfirm(null);
        try {
          const { priorThumb } = await revertMutation.mutateAsync({ ratingKey });
          utils.collections.artworkState.invalidate({ ratingKey });
          // Be exact about what happened. "Reverted" would imply an image was
          // put back, and usually there is none to put back.
          addToast(
            priorThumb
              ? "Artwork unmanaged — the original poster is still in Plex's picker"
              : "Artwork unmanaged — nothing on the collection changed",
            "success",
          );
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
  const visibleLabels = labels.filter((l) => !isPlumbingLabel(l));
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
    <div>
      <PageCrumbs crumbs={[{ label: collection.title }]} />

      {/* Presentation only. Everything here is read — the pencil opens the
          editor, the poster is changed from the actions menu. The header used
          to be three different edit idioms stacked on each other (an inline
          title input, an always-open textarea, a label field that appeared on
          hover) with a sticky bar that slid in to commit two of the three. */}
      <header className={local.hero}>
        <div className={local.posterFrame}>
          {collection.thumb ? (
            <FadeImage className={local.posterImg} src={plexImageUrl(collection.thumb)} alt="" />
          ) : (
            <div className={local.posterEmpty}>No poster</div>
          )}
        </div>

        <div className={local.heroMain}>
          <div className={local.heroTop}>
            {/* Library, name, facts: three sizes descending, so the eye lands on
                the name and reads outward from it. */}
            <div className={local.heroIdentity}>
              <div className={local.eyebrow}>{collection.sectionTitle}</div>
              <h2 className={local.heroTitle}>{collection.title}</h2>
            </div>
            <div className={local.heroActions}>
              <button
                className={styles.buttonSecondary}
                onClick={() => setEditOpen(true)}
                title="Edit name, summary and labels"
              >
                <Pencil size="1.3rem" />
                Edit
              </button>
              <button
                className={pinned ? styles.buttonSecondary : styles.button}
                onClick={handleTogglePin}
                disabled={pinQuery.isLoading || pinMutation.isPending || unpinMutation.isPending}
                title={rotatedBy ? "Lasts until the rule's next run" : "Pin to the Plex home screen"}
              >
                {pinned ? <PinOff size="1.3rem" /> : <Pin size="1.3rem" />}
                {pinned ? "Unpin" : "Pin"}
              </button>
              {rotatedBy && (
                <span className={styles.metaChip} title="Re-chosen on every run of this rule">
                  Rotated by {rotatedBy}
                </span>
              )}
              <RowActions actions={actions} label="Collection actions" />
            </div>
          </div>

          {/* Facts and state on one line: counts read as running text, the
              things that are genuinely categorical read as chips, and a hairline
              keeps the two from being mistaken for each other. These used to be
              five chips of equal weight to the title, which is why nothing on
              the page read as primary. */}
          <div className={local.metaLine}>
            <span>
              <strong className={local.metaNum}>{(items.length || collection.childCount).toLocaleString()}</strong>{" "}
              items
            </span>
            {collection.addedAt && (
              <>
                <span className={local.metaDot}>·</span>
                <span>
                  added <RelativeTime timestamp={collection.addedAt} seconds />
                </span>
              </>
            )}
            {(isSmart || pinned || owningRuleQuery.data) && (
              <>
                <span className={local.metaRule} aria-hidden="true" />
                <span className={local.chipGroup}>
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
                </span>
              </>
            )}
          </div>

          {(collection.summary || visibleLabels.length > 0) && <div className={local.heroRule} />}

          {collection.summary && <p className={local.summaryText}>{collection.summary}</p>}

          {visibleLabels.length > 0 && (
            <div className={local.labelRow}>
              <span className={local.labelLead}>Labels</span>
              {/* A label is the one thing on this page that names a set rather
                  than this collection, so it goes where that set is listed.
                  `label` is repeatable on Collections, which is the same
                  parameter its own filter chips write. */}
              {visibleLabels.map((label) => (
                <Link
                  key={label}
                  to={`/collections?label=${encodeURIComponent(label)}`}
                  title={`Show collections labelled "${label}"`}
                  className={`${styles.label} ${local.labelChip} ${local.labelChipLink} ${
                    SYSTEM_LABELS.includes(label.toLowerCase())
                      ? styles.labelTinkerbell
                      : label.toLowerCase().startsWith("user:")
                        ? styles.labelUser
                        : ""
                  }`}
                >
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </header>

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
          openStudio: () => setStudioOpen(true),
        }}
      >
        {/* Keyed on the path so a tab switch remounts rather than carrying the
            previous tab's local state into a different view. */}
        <Fragment key={location.pathname}>
          <Outlet />
        </Fragment>
      </CollectionProvider>

      {editOpen && (
        <CollectionEditModal
          ratingKey={ratingKey!}
          title={collection.title}
          summary={collection.summary || ""}
          labels={labels}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            refresh();
          }}
        />
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
    </div>
  );
}
