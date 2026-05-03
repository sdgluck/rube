import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import FadeImage from "../FadeImage";
import { trpc } from "../trpc";
import styles from "./Preview.module.css";

const COLLECTION_HUB_PREFIX = "custom.collection.";

function parseCollectionRatingKey(hubIdentifier: string): string | null {
  if (!hubIdentifier.startsWith(COLLECTION_HUB_PREFIX)) return null;
  const rest = hubIdentifier.slice(COLLECTION_HUB_PREFIX.length);
  const lastDot = rest.lastIndexOf(".");
  const ratingKey = lastDot < 0 ? rest : rest.slice(lastDot + 1);
  return ratingKey || null;
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
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw || raw === "null") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function readStoredSectionId(): number | null {
  const raw = localStorage.getItem(SECTION_STORAGE_KEY);
  if (!raw || raw === "null") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function thumbUrl(path: string | undefined): string | null {
  if (!path) return null;
  return `/api/plex-image?path=${encodeURIComponent(path)}`;
}

function pickPosterPath(item: {
  type: string;
  thumb?: string;
  parentThumb?: string;
  grandparentThumb?: string;
}): string | undefined {
  // For episodes, prefer the show poster (grandparentThumb) — matches Plex.
  if (item.type === "episode") return item.grandparentThumb || item.parentThumb || item.thumb;
  if (item.type === "season") return item.parentThumb || item.thumb;
  return item.thumb;
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

function pickWideArtPath(item: {
  type: string;
  art?: string;
  thumb?: string;
  parentThumb?: string;
  grandparentThumb?: string;
}): string | undefined {
  if (item.type === "episode") return item.thumb || item.art;
  return item.art || item.thumb;
}

export default function Preview() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [userId, setUserId] = useState<number | null>(readStoredUserId);
  const [sectionId, setSectionId] = useState<number | null>(readStoredSectionId);
  const [hubOrder, setHubOrder] = useState<string[] | null>(null);
  const [shuffleStatus, setShuffleStatus] = useState<string | null>(null);

  const usersQuery = trpc.users.list.useQuery({ limit: 200, offset: 0 });
  const sectionsQuery = trpc.plexSections.useQuery();
  const rulesQuery = trpc.rules.list.useQuery();
  const previewQuery = trpc.preview.home.useQuery({ userId, sectionId });

  const ruleCollectionKeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of rulesQuery.data ?? []) {
      if (r.lastCollectionRatingKey) set.add(r.lastCollectionRatingKey);
    }
    return set;
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
    localStorage.setItem(STORAGE_KEY, next == null ? "null" : String(next));
  };

  const onPickSection = (next: number | null) => {
    setSectionId(next);
    localStorage.setItem(SECTION_STORAGE_KEY, next == null ? "null" : String(next));
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
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Preview</h1>
          <span
            className={styles.badge}
            title="Approximate — labels and library access only; watch progress is the admin's"
          >
            Approximate
          </span>
        </div>
        <div className={styles.userPicker}>
          <button
            className={styles.shuffleBtn}
            onClick={onShuffle}
            disabled={shuffleMutation.isPending}
            title="Reorder pinned collection hubs on Plex (affects all users)"
          >
            {shuffleMutation.isPending ? "Shuffling…" : "Shuffle hubs"}
          </button>
          <label htmlFor="preview-user">View as</label>
          <select
            id="preview-user"
            className={styles.userSelect}
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
          <label htmlFor="preview-section">Library</label>
          <select
            id="preview-section"
            className={styles.userSelect}
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
        </div>
      </div>

      {shuffleStatus && <div className={styles.warnings}>{shuffleStatus}</div>}

      {previewQuery.isLoading && <div className={styles.empty}>Loading preview…</div>}
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
        const isRuleManaged = collectionRatingKey ? ruleCollectionKeys.has(collectionRatingKey) : false;
        return (
          <section key={hub.identifier || hub.key || hub.title} className={styles.hub}>
            <h3 className={styles.hubTitle}>
              {hub.title}
              <span className={styles.hubMeta}>{hub.items.length} items</span>
              {collectionRatingKey && (
                <>
                  <Link
                    to={`/collections/${collectionRatingKey}`}
                    className={styles.hubLink}
                    title="Open collection in Tinkerbell"
                  >
                    Open
                  </Link>
                  <span
                    className={`${styles.hubSource} ${isRuleManaged ? styles.hubSourceRule : styles.hubSourceUser}`}
                    title={isRuleManaged ? "Generated by a Tinkerbell rule" : "Created manually in Plex"}
                  >
                    {isRuleManaged ? "Rule" : "User"}
                  </span>
                </>
              )}
            </h3>
            <div className={styles.row}>
              {hub.items.map((item) => {
                const path = wide ? pickWideArtPath(item) : pickPosterPath(item);
                const src = thumbUrl(path);
                const progress =
                  item.viewOffset && item.duration && item.duration > 0
                    ? Math.min(1, item.viewOffset / item.duration)
                    : 0;
                return (
                  <div
                    key={item.ratingKey}
                    className={`${styles.card} ${wide ? styles.cardWide : ""}`}
                    onClick={() => navigate(`/media/${item.ratingKey}`)}
                  >
                    <div className={styles.posterWrap}>
                      {src ? (
                        <FadeImage className={styles.poster} src={src} alt={item.title} loading="lazy" />
                      ) : (
                        <div className={styles.posterPlaceholder}>No image</div>
                      )}
                      {progress > 0 && (
                        <div className={styles.progressTrack}>
                          <div className={styles.progressFill} style={{ width: `${progress * 100}%` }} />
                        </div>
                      )}
                    </div>
                    <div className={styles.cardTitle} title={item.title}>
                      {item.type === "episode" && item.grandparentTitle ? item.grandparentTitle : item.title}
                    </div>
                    <div className={styles.cardMeta}>
                      {item.type === "episode"
                        ? item.parentIndex != null && item.index != null
                          ? `S${item.parentIndex} · E${item.index} · ${item.title}`
                          : item.title
                        : (item.year ?? item.librarySectionTitle ?? "")}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
