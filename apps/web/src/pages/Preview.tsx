import { useMemo, useState } from "react";
import { readStorage, writeStorage } from "#/storage";
import { Link, useNavigate } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import ConfirmModal from "#components/ConfirmModal";
import PageShell, { StatusChip } from "#components/PageShell";
import { PreviewHubRow, PreviewHubRowSkeleton } from "#components/PreviewHubRow";
import Spinner from "#components/Spinner";
import { useToast } from "#components/Toast";
import { trpc } from "#/trpc";
import styles from "./Preview.module.css";

// Layout matches Plex's home: a couple of wide (Continue Watching-style)
// rows up top, then taller poster rows below. Mirroring the eventual UI
// gives a much less jarring transition than a generic table skeleton.
const SKELETON_HUBS: Array<{ wide: boolean; cards: number }> = [
  { wide: true, cards: 5 },
  { wide: false, cards: 8 },
  { wide: false, cards: 8 },
  { wide: false, cards: 8 },
];

function PreviewSkeleton() {
  return (
    <>
      {SKELETON_HUBS.map((hub, i) => (
        <PreviewHubRowSkeleton key={i} wide={hub.wide} cards={hub.cards} />
      ))}
    </>
  );
}

const COLLECTION_HUB_PREFIX = "custom.collection.";

function parseCollectionRatingKey(hubIdentifier: string): string | null {
  if (!hubIdentifier.startsWith(COLLECTION_HUB_PREFIX)) return null;
  const rest = hubIdentifier.slice(COLLECTION_HUB_PREFIX.length);
  const lastDot = rest.lastIndexOf(".");
  const ratingKey = lastDot < 0 ? rest : rest.slice(lastDot + 1);
  return ratingKey || null;
}

function parseCollectionSectionId(hubIdentifier: string): string | null {
  // Plex hub identifiers are shaped `custom.collection.{sectionId}.{ratingKey}…`
  // — the library-section key is the FIRST segment after the prefix, not
  // everything-before-the-last-dot (some identifiers carry trailing segments
  // and the section key is always a bare integer).
  if (!hubIdentifier.startsWith(COLLECTION_HUB_PREFIX)) return null;
  const rest = hubIdentifier.slice(COLLECTION_HUB_PREFIX.length);
  const firstDot = rest.indexOf(".");
  if (firstDot <= 0) return null;
  return rest.slice(0, firstDot) || null;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const STORAGE_KEY = "preview.userId";
const SECTION_STORAGE_KEY = "preview.sectionId";

function readStoredUserId(): number | null {
  const raw = readStorage(STORAGE_KEY);
  if (!raw || raw === "null") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function readStoredSectionId(): number | null {
  const raw = readStorage(SECTION_STORAGE_KEY);
  if (!raw || raw === "null") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function isWideHub(hub: { type: string; identifier: string; context?: string }): boolean {
  // Continue Watching / On Deck show 16:9 art tiles in Plex.
  const ctx = (hub.context || "").toLowerCase();
  const id = hub.identifier.toLowerCase();
  return (
    ctx.includes("continuewatching") ||
    ctx.includes("ondeck") ||
    id.includes("continueWatching".toLowerCase()) ||
    id.includes("ondeck") ||
    hub.type === "clip"
  );
}

export default function Preview() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { addToast } = useToast();
  const [userId, setUserId] = useState<number | null>(readStoredUserId);
  const [sectionId, setSectionId] = useState<number | null>(readStoredSectionId);
  const [hubOrder, setHubOrder] = useState<string[] | null>(null);
  const [shuffleStatus, setShuffleStatus] = useState<string | null>(null);
  const [unpinTarget, setUnpinTarget] = useState<{
    sectionId: string;
    hubIdentifier: string;
    title: string;
  } | null>(null);

  const usersQuery = trpc.users.list.useQuery({ limit: 200, offset: 0 });
  const sectionsQuery = trpc.plexSections.useQuery();
  const rulesQuery = trpc.rules.list.useQuery();
  // Two-stage fetch: the fast query (12 items/hub) paints the page quickly;
  // the full query (25 items/hub) runs immediately after and silently swaps
  // in deeper content for hubs the user might scroll within.
  const fastInput = { userId, sectionId, count: 12 } as const;
  const fullInput = { userId, sectionId, count: 25 } as const;
  const fastQuery = trpc.preview.home.useQuery(fastInput, {
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const fullQuery = trpc.preview.home.useQuery(fullInput, {
    // Don't fire the heavier request until the fast one has returned; this
    // keeps the Plex server doing one thing at a time and matches user
    // perception of "fast first, full after".
    enabled: !!fastQuery.data,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const previewQuery = {
    data: fullQuery.data ?? fastQuery.data,
    isLoading: fastQuery.isLoading,
    error: fullQuery.error ?? fastQuery.error,
  };

  const unpinMutation = trpc.preview.unpinCollection.useMutation({
    onMutate: async ({ hubIdentifier }) => {
      // Apply the optimistic removal to BOTH the fast and full caches so the
      // hub disappears from screen regardless of which query last won.
      const inputs = [fastInput, fullInput] as const;
      await Promise.all(inputs.map((i) => utils.preview.home.cancel(i)));
      const prev = inputs.map((i) => ({ input: i, data: utils.preview.home.getData(i) }));
      for (const { input, data } of prev) {
        if (data) {
          utils.preview.home.setData(input, {
            ...data,
            hubs: data.hubs.filter((h) => h.identifier !== hubIdentifier),
          });
        }
      }
      return { prev };
    },
    onError: (err, _input, ctx) => {
      for (const { input, data } of ctx?.prev ?? []) {
        if (data) utils.preview.home.setData(input, data);
      }
      addToast(`Failed to unpin: ${err.message}`, "error");
    },
    onSuccess: () => {
      addToast("Collection unpinned from homepage", "success");
    },
    onSettled: () => {
      utils.preview.home.invalidate();
    },
  });

  // Names, not ids: the Rules link narrows that page by search term.
  const ruleNameByCollectionKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rulesQuery.data ?? []) {
      if (r.lastCollectionRatingKey) map.set(r.lastCollectionRatingKey, r.name);
    }
    return map;
  }, [rulesQuery.data]);
  const shuffleMutation = trpc.preview.shuffleHubs.useMutation({
    onSuccess: async (res) => {
      setShuffleStatus(`Shuffled ${res.totalShuffled} hub${res.totalShuffled === 1 ? "" : "s"} on Plex.`);
      await utils.preview.home.invalidate();
      setHubOrder(null);
      setTimeout(() => setShuffleStatus(null), 4000);
    },
    onError: (err) => {
      setShuffleStatus(`Shuffle failed: ${err.message}`);
      setHubOrder(null);
    },
  });

  const users = usersQuery.data?.items ?? [];
  const sections = (sectionsQuery.data ?? []).filter((s) => s.type === "movie" || s.type === "show");
  const viewingAs = users.find((u) => u.userId === userId);
  const viewingAsLabel = viewingAs ? `as ${viewingAs.name || viewingAs.username}` : "as admin";

  const orderedHubs = useMemo(() => {
    const hubs = previewQuery.data?.hubs ?? [];
    if (!hubOrder) return hubs;
    const byId = new Map(hubs.map((h) => [h.identifier || h.key || h.title, h]));
    const seen = new Set<string>();
    const out: typeof hubs = [];
    for (const id of hubOrder) {
      const h = byId.get(id);
      if (h) {
        out.push(h);
        seen.add(id);
      }
    }
    for (const h of hubs) {
      const id = h.identifier || h.key || h.title;
      if (!seen.has(id)) out.push(h);
    }
    return out;
  }, [previewQuery.data, hubOrder]);

  const onPickUser = (next: number | null) => {
    setUserId(next);
    writeStorage(STORAGE_KEY, next == null ? "null" : String(next));
  };

  const onPickSection = (next: number | null) => {
    setSectionId(next);
    writeStorage(SECTION_STORAGE_KEY, next == null ? "null" : String(next));
  };

  const onShuffle = () => {
    const hubs = previewQuery.data?.hubs ?? [];
    const collectionHubIds = hubs
      .map((h) => h.identifier || h.key || h.title)
      .filter((id) => id.startsWith(COLLECTION_HUB_PREFIX));
    if (collectionHubIds.length < 2) {
      setShuffleStatus("Need at least 2 pinned collection hubs to shuffle.");
      setTimeout(() => setShuffleStatus(null), 3000);
      return;
    }
    const shuffled = shuffleArray(collectionHubIds);
    const newOrder: string[] = [];
    let pulled = 0;
    for (const h of hubs) {
      const id = h.identifier || h.key || h.title;
      if (id.startsWith(COLLECTION_HUB_PREFIX)) {
        newOrder.push(shuffled[pulled++]);
      } else {
        newOrder.push(id);
      }
    }
    setHubOrder(newOrder);
    setShuffleStatus("Shuffling on Plex…");
    shuffleMutation.mutate();
  };

  return (
    <PageShell
      chip={<StatusChip tone="advisory">Approximate</StatusChip>}
      actions={
        <>
          <button
            className={styles.shuffleBtn}
            onClick={onShuffle}
            disabled={shuffleMutation.isPending}
            title="Reorder pinned collection hubs on Plex (affects all users)"
          >
            {shuffleMutation.isPending ? (
              <>
                <Spinner size="xs" /> Shuffling…
              </>
            ) : (
              "Shuffle hubs"
            )}
          </button>
          <label className={styles.pickerLabel} htmlFor="preview-section">
            Library
          </label>
          <select
            id="preview-section"
            className={styles.pickerSelect}
            value={sectionId == null ? "" : String(sectionId)}
            onChange={(e) => onPickSection(e.target.value === "" ? null : Number(e.target.value))}
          >
            <option value="">All libraries</option>
            {sections.map((s) => (
              <option key={s.key} value={s.key}>
                {s.title}
              </option>
            ))}
          </select>
          <label className={styles.pickerLabel} htmlFor="preview-user">
            View as
          </label>
          <select
            id="preview-user"
            className={styles.pickerSelect}
            value={userId == null ? "" : String(userId)}
            onChange={(e) => onPickUser(e.target.value === "" ? null : Number(e.target.value))}
          >
            <option value="">Admin (no filters)</option>
            {users.map((u) => (
              <option key={u.userId} value={u.userId}>
                {u.name ? `${u.name} (${u.username})` : u.username}
              </option>
            ))}
          </select>
        </>
      }
    >
      {/* The stage is Plex's, not ours: dark, chrome-free, posters dominant. */}
      <div className={styles.page}>
        <span className={styles.stageChip}>Plex home · {viewingAsLabel}</span>

        {shuffleStatus && <div className={styles.warnings}>{shuffleStatus}</div>}

        {previewQuery.isLoading && <PreviewSkeleton />}
        {previewQuery.error && (
          <div className={styles.warnings}>
            <div>Failed to load preview: {previewQuery.error.message}</div>
          </div>
        )}

        {previewQuery.data && previewQuery.data.warnings.length > 0 && (
          <div className={styles.warnings}>
            {previewQuery.data.warnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        )}

        {previewQuery.data && previewQuery.data.hubs.length === 0 && !previewQuery.isLoading && (
          <div className={styles.empty}>No hubs to show.</div>
        )}

        {orderedHubs.map((hub) => {
          const wide = isWideHub(hub);
          const collectionRatingKey = parseCollectionRatingKey(hub.identifier);
          const collectionSectionId = parseCollectionSectionId(hub.identifier);
          const ruleName = collectionRatingKey ? ruleNameByCollectionKey.get(collectionRatingKey) : undefined;
          const isUnpinning = unpinMutation.isPending && unpinMutation.variables?.hubIdentifier === hub.identifier;
          const chips = collectionRatingKey ? (
            <>
              {ruleName ? (
                <Link
                  to={`/rules?q=${encodeURIComponent(ruleName)}`}
                  className={styles.hubChip}
                  title="Generated by a Tinkerbell rule — open in Rules"
                >
                  Rule
                </Link>
              ) : (
                <span className={`${styles.hubChip} ${styles.hubChipStatic}`} title="Created manually in Plex">
                  User
                </span>
              )}
              <Link
                to={`/collections/${collectionRatingKey}`}
                className={styles.hubChip}
                title="Open collection in Tinkerbell"
              >
                Open
              </Link>
              {collectionSectionId && (
                <button
                  type="button"
                  className={`${styles.hubChip} ${styles.hubChipDanger}`}
                  disabled={isUnpinning}
                  title="Unpin this collection from the Plex homepage"
                  onClick={() =>
                    setUnpinTarget({
                      sectionId: collectionSectionId,
                      hubIdentifier: hub.identifier,
                      title: hub.title,
                    })
                  }
                >
                  {isUnpinning ? (
                    <>
                      <Spinner size="xs" /> Unpinning…
                    </>
                  ) : (
                    "Unpin"
                  )}
                </button>
              )}
            </>
          ) : undefined;
          return (
            <PreviewHubRow
              key={hub.identifier || hub.key || hub.title}
              title={hub.title}
              chips={chips}
              items={hub.items}
              wide={wide}
              onItemClick={(item) => navigate(`/media/${item.ratingKey}`)}
            />
          );
        })}

        {unpinTarget && (
          <ConfirmModal
            message={`Unpin “${unpinTarget.title}” from the Plex homepage? Other Tinkerbell-managed pinning rules may re-pin it later.`}
            title="Unpin from homepage?"
            confirmLabel="Unpin"
            danger
            onConfirm={() => {
              unpinMutation.mutate({
                sectionId: unpinTarget.sectionId,
                hubIdentifier: unpinTarget.hubIdentifier,
              });
              setUnpinTarget(null);
            }}
            onCancel={() => setUnpinTarget(null)}
          />
        )}
      </div>
    </PageShell>
  );
}
