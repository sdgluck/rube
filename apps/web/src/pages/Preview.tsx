import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { readStorage, writeStorage } from "#/storage";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import ConfirmModal from "#components/ConfirmModal";
import PageShell, { StatusChip } from "#components/PageShell";
import { PreviewHubRow, PreviewHubRowSkeleton } from "#components/PreviewHubRow";
import RelativeTime from "#components/RelativeTime";
import SearchSelect from "#components/SearchSelect";
import Spinner from "#components/Spinner";
import { useToast } from "#components/Toast";
import { formatRelativeTime } from "#hooks/useRelativeTime";
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

// The view lives in the URL (`?user=…&library=…`) so "what Bob sees" is a
// link, and Back steps through the users you looked at. Storage still holds
// the last view, for arriving at a bare /preview from the sidebar.
const USER_PARAM = "user";
const LIBRARY_PARAM = "library";

function parseId(raw: string | null): number | null {
  if (!raw || raw === "null") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Last run, as one line for a chip's tooltip. */
function describeRuleRun(rule: {
  name: string;
  enabled: number | boolean;
  lastRunAt: number | null;
  lastRunStatus: string | null;
  lastRunItemCount: number | null;
}): string {
  const head = `Rule “${rule.name}”${rule.enabled ? "" : " (disabled)"}`;
  if (!rule.lastRunAt) return `${head} — not run yet. Open in Rules.`;
  const when = formatRelativeTime(rule.lastRunAt);
  const run =
    rule.lastRunStatus === "ok"
      ? `last ran ${when}, ${rule.lastRunItemCount ?? 0} item${rule.lastRunItemCount === 1 ? "" : "s"}`
      : `last run ${rule.lastRunStatus ?? "unknown"} ${when}`;
  return `${head} — ${run}. Open in Rules.`;
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

function viewParams(userId: number | null, sectionId: number | null): URLSearchParams {
  const next = new URLSearchParams();
  // Always named, admin included: a bare /preview means "the last view", so a
  // history entry without it would come back as whoever was viewed most
  // recently rather than what that entry showed.
  next.set(USER_PARAM, userId == null ? "admin" : String(userId));
  if (sectionId != null) next.set(LIBRARY_PARAM, String(sectionId));
  return next;
}

export default function Preview() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { addToast } = useToast();
  const [params, setParams] = useSearchParams();
  // A URL that names neither falls back to the last view rather than the
  // admin's, read here rather than after a redirect so the first request is
  // already for the right user.
  const urlNamesView = params.has(USER_PARAM) || params.has(LIBRARY_PARAM);
  const userId = urlNamesView ? parseId(params.get(USER_PARAM)) : parseId(readStorage(STORAGE_KEY));
  const sectionId = urlNamesView ? parseId(params.get(LIBRARY_PARAM)) : parseId(readStorage(SECTION_STORAGE_KEY));
  // ...and then writes that view into the URL, replacing the bare entry, so a
  // copied link says what it shows and Back never lands on a bare entry.
  useEffect(() => {
    if (urlNamesView) return;
    setParams(viewParams(userId, sectionId), { replace: true });
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);
  const [hubOrder, setHubOrder] = useState<string[] | null>(null);
  const [shuffleStatus, setShuffleStatus] = useState<string | null>(null);
  const [confirmShuffle, setConfirmShuffle] = useState(false);
  const [shuffleProgress, setShuffleProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
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
  // keepPreviousData leaves the last user's (or library's) hubs on screen
  // while the new home loads, which on a slow Plex reads as the picker having
  // done nothing. Mark that window so the stale rows are visibly stale.
  const isSwitching = fastQuery.isPlaceholderData && fastQuery.isFetching;
  const updatedAt = Math.max(fastQuery.dataUpdatedAt, fullQuery.dataUpdatedAt);

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

  const ruleByCollectionKey = useMemo(() => {
    const map = new Map<string, NonNullable<typeof rulesQuery.data>[number]>();
    for (const r of rulesQuery.data ?? []) {
      if (r.lastCollectionRatingKey) map.set(r.lastCollectionRatingKey, r);
    }
    return map;
  }, [rulesQuery.data]);
  const topPinnedQuery = trpc.preview.topPinned.useQuery();
  const topPinned = useMemo(() => new Set(topPinnedQuery.data ?? []), [topPinnedQuery.data]);
  const shuffleSection = trpc.preview.shuffleSection.useMutation();
  const refreshMutation = trpc.preview.refresh.useMutation();

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      // The server keeps homes for 30s; refetching without dropping them
      // would hand back the same answer and look like the button did nothing.
      await refreshMutation.mutateAsync();
      await utils.preview.home.invalidate();
    } catch (err) {
      addToast(`Refresh failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setRefreshing(false);
    }
  };

  const users = usersQuery.data?.items ?? [];
  const userOptions = useMemo(
    () => [
      { value: "", label: "Admin (no filters)" },
      ...users.map((u) => ({
        value: String(u.userId),
        label: u.name || u.username,
        detail: u.name && u.name !== u.username ? u.username : undefined,
      })),
    ],
    [users],
  );
  const selectedUser = userId == null ? null : users.find((u) => u.userId === userId);
  const viewingAs = userId == null ? "Admin" : selectedUser ? selectedUser.name || selectedUser.username : "user";
  const sections = (sectionsQuery.data ?? []).filter((s) => s.type === "movie" || s.type === "show");

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

  // A push, not a replace: Back should return to the user you were viewing.
  const onPickUser = (next: number | null) => {
    setParams(viewParams(next, sectionId));
    writeStorage(STORAGE_KEY, next == null ? "null" : String(next));
  };

  const onPickSection = (next: number | null) => {
    setParams(viewParams(userId, next));
    writeStorage(SECTION_STORAGE_KEY, next == null ? "null" : String(next));
  };

  /**
   * One library at a time, so the page can say which one Plex is on. Each
   * library's shuffle puts its own hubs back if it fails partway, so stopping
   * at the first failure leaves every library either shuffled or untouched.
   */
  const runShuffle = async () => {
    let total = 0;
    let done = 0;
    let current = "";
    try {
      const targets = await utils.preview.shuffleTargets.fetch(undefined, { staleTime: 0 });
      total = targets.length;
      let shuffled = 0;
      for (const target of targets) {
        current = target.title;
        setShuffleProgress({ done, total, current });
        const res = await shuffleSection.mutateAsync({ sectionKey: target.key });
        shuffled += res.shuffled;
        done++;
      }
      setShuffleStatus(
        `Shuffled ${shuffled} hub${shuffled === 1 ? "" : "s"} across ${total} librar${total === 1 ? "y" : "ies"} on Plex.`,
      );
      setTimeout(() => setShuffleStatus(null), 4000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setShuffleStatus(
        current
          ? `Shuffle stopped at ${current}: ${message}.${done > 0 ? ` The ${done} librar${done === 1 ? "y" : "ies"} before it ${done === 1 ? "was" : "were"} shuffled.` : ""}`
          : `Shuffle failed: ${message}`,
      );
    } finally {
      setShuffleProgress(null);
      setHubOrder(null);
      await utils.preview.home.invalidate();
    }
  };

  const onShuffle = () => {
    const hubs = previewQuery.data?.hubs ?? [];
    // Rows kept at the top stay out of the shuffle and go first, as the server
    // does it — otherwise the page would show them jumping, then snap back.
    const isTop = (id: string) => topPinned.has(parseCollectionRatingKey(id) ?? "");
    const collectionHubIds = hubs
      .map((h) => h.identifier || h.key || h.title)
      .filter((id) => id.startsWith(COLLECTION_HUB_PREFIX) && !isTop(id));
    if (collectionHubIds.length < 2) {
      setShuffleStatus("Need at least 2 pinned collection hubs, besides the ones kept at the top, to shuffle.");
      setTimeout(() => setShuffleStatus(null), 3000);
      return;
    }
    const shuffled = [
      ...hubs.map((h) => h.identifier || h.key || h.title).filter((id) => isTop(id)),
      ...shuffleArray(collectionHubIds),
    ];
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
    setShuffleStatus(null);
    void runShuffle();
  };
  const isShuffling = shuffleProgress != null;

  return (
    <PageShell
      chip={previewQuery.data?.approximate ? <StatusChip tone="advisory">Approximate</StatusChip> : undefined}
      actions={
        <>
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
          <SearchSelect
            id="preview-user"
            className={styles.pickerSelect}
            ariaLabel="View as"
            value={userId == null ? "" : String(userId)}
            options={userOptions}
            onChange={(v) => onPickUser(v === "" ? null : Number(v))}
          />
          <button
            className={styles.shuffleBtn}
            onClick={() => setConfirmShuffle(true)}
            disabled={isShuffling}
            title="Reorder pinned collection hubs on Plex (affects all users)"
          >
            {shuffleProgress ? (
              <>
                <Spinner size="xs" /> Shuffling {Math.min(shuffleProgress.done + 1, shuffleProgress.total)}/
                {shuffleProgress.total}…
              </>
            ) : (
              "Shuffle hubs"
            )}
          </button>
        </>
      }
    >
      {/* The stage is Plex's, not ours: dark, chrome-free, posters dominant. */}
      <div className={styles.page} aria-busy={isSwitching}>
        {isSwitching && (
          <div className={styles.switching}>
            <Spinner size="xs" variant="inverse" label={`Loading ${viewingAs}'s home`} />
            Loading {viewingAs}&rsquo;s home…
          </div>
        )}
        {(updatedAt > 0 || refreshing) && (
          <div className={styles.stageBar}>
            {updatedAt > 0 && (
              <span className={styles.updated}>
                Updated <RelativeTime timestamp={updatedAt} />
              </span>
            )}
            <button
              type="button"
              className={styles.hubChip}
              onClick={onRefresh}
              disabled={refreshing || isShuffling}
              title="Fetch this home from Plex again"
            >
              {refreshing ? <Spinner size="xs" variant="inverse" /> : <RefreshCw size="1.1rem" aria-hidden />}
              Refresh
            </button>
          </div>
        )}
        {shuffleProgress && (
          <div className={styles.warnings} role="status">
            <div>
              Shuffling {shuffleProgress.current} — library {shuffleProgress.done + 1} of {shuffleProgress.total}. Its
              collection rows are briefly missing from Plex while they are re-pinned.
            </div>
            <progress
              className={styles.shuffleProgress}
              value={shuffleProgress.done}
              max={shuffleProgress.total}
              aria-label="Shuffle progress"
            />
          </div>
        )}
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
          const rule = collectionRatingKey ? ruleByCollectionKey.get(collectionRatingKey) : undefined;
          const isUnpinning = unpinMutation.isPending && unpinMutation.variables?.hubIdentifier === hub.identifier;
          const chips = collectionRatingKey ? (
            <>
              {topPinned.has(collectionRatingKey) && (
                <span
                  className={`${styles.hubProv} ${styles.hubProvStatic}`}
                  title="Kept at the top — shuffles leave it first"
                >
                  Top
                </span>
              )}
              {rule ? (
                <Link
                  // `q` narrows the list behind the editor to this rule; `edit` opens it.
                  to={`/rules?q=${encodeURIComponent(rule.name)}&edit=${encodeURIComponent(rule.id)}`}
                  className={styles.hubProv}
                  title={describeRuleRun(rule)}
                >
                  Rule
                </Link>
              ) : (
                <span className={`${styles.hubProv} ${styles.hubProvStatic}`} title="Created manually in Plex">
                  User
                </span>
              )}
              <Link
                to={`/collections/${collectionRatingKey}`}
                className={styles.hubChip}
                title="Open collection in Rube"
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

        {confirmShuffle && (
          <ConfirmModal
            title="Shuffle hubs for everyone?"
            message="This reorders the pinned collection rows on Plex's home for every user, not only the one you're viewing. Each library's rows are unpinned and pinned again in the new order, so for a few seconds they are missing from Plex."
            confirmLabel="Shuffle"
            onConfirm={() => {
              setConfirmShuffle(false);
              onShuffle();
            }}
            onCancel={() => setConfirmShuffle(false)}
          />
        )}

        {unpinTarget && (
          <ConfirmModal
            message={`Unpin “${unpinTarget.title}” from the Plex homepage? Other Rube-managed pinning rules may re-pin it later.`}
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
