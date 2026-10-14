/**
 * Stand-in for a Plex Media Server, just enough for the admin UI to render
 * demo screenshots. It serves four kinds of request:
 *
 *  - images (`…/thumb/…`, `/photo/:/transcode`) → a synthetic poster PNG built
 *    from the rating key's invented title. This is what the server's
 *    `/api/plex-image` proxy fetches, so its origin must equal the configured
 *    `global_plex_url`.
 *  - `/library/sections/:id/all` → a page of items (for the Overlays sample).
 *  - `/library/metadata/:keys` → full metadata for items AND collections, the
 *    latter carrying the `content` URI the Smart Filters editor parses.
 *  - `/library/metadata/:key/children` → a collection's items.
 *  - `/hubs` → home hubs built from the demo collections (for the Preview page).
 *  - `/hubs/sections/:id/manage` → which of a section's collections are pinned.
 *
 * Anything else returns an empty-but-valid `{ MediaContainer }` so stray live
 * Plex calls (sessions, poster candidates) resolve instead of 500ing.
 */

import { createServer, type Server } from "node:http";
import { ITEMS, COLLECTIONS, ITEM_BY_RATING_KEY, thumbPath, type DemoItem } from "./data.ts";
import { poster } from "./posters.ts";

const ITEM_BY_KEY = new Map(ITEMS.map((i) => [i.ratingKey, i]));
const COLLECTION_BY_KEY = new Map(COLLECTIONS.map((c) => [c.ratingKey, c]));

/** Plex identifies a server by machine id; the smart-filter envelope carries it. */
const MACHINE_ID = "demo-machine-id";

/**
 * A smart collection's `content` is the saved filter URI. The Smart Filters
 * editor parses this into its tree, so it has to be shaped the way Plex writes
 * it — otherwise the drawer opens on an empty group. Two clauses and a nested
 * OR, to exercise the depth rails.
 */
function smartContent(sectionId: string, type: string): string {
  const query = [
    `type=${type}`,
    "sort=rating%3Adesc",
    "genre=Science%20Fiction",
    "push=1",
    "year>>=2015",
    "or=1",
    "userRating>>=8",
    "pop=1",
  ].join("&");
  return `server://${MACHINE_ID}/com.plexapp.plugins.library/library/sections/${sectionId}/all?${query}`;
}

/** The dynamic query path a smart collection resolves its items through. */
function smartKey(sectionId: string, type: string): string {
  return `/library/sections/${sectionId}/all?type=${type}&sort=rating%3Adesc`;
}

function collectionMetadata(c: (typeof COLLECTIONS)[number]) {
  const type = c.sectionId === "1" ? "1" : "2";
  return {
    ratingKey: c.ratingKey,
    key: c.smart ? smartKey(c.sectionId, type) : `/library/metadata/${c.ratingKey}/children`,
    title: c.title,
    summary: c.summary,
    type: "collection",
    subtype: c.sectionId === "1" ? "movie" : "show",
    smart: c.smart ? "1" : "0",
    content: c.smart ? smartContent(c.sectionId, type) : "",
    thumb: thumbPath(c.ratingKey),
    childCount: c.itemRatingKeys.length,
    addedAt: 1_700_000_000,
    librarySectionID: Number(c.sectionId),
    librarySectionTitle: c.sectionTitle,
    Label: c.labels.map((tag) => ({ tag })),
  };
}

function collectionChildren(c: (typeof COLLECTIONS)[number]) {
  const metas = c.itemRatingKeys
    .map((k) => ITEM_BY_KEY.get(k))
    .filter((x): x is DemoItem => Boolean(x))
    .map(metadata);
  return { size: metas.length, totalSize: metas.length, Metadata: metas };
}

/** Synthetic but deterministic ratings so overlay badges have something to show. */
function ratingsFor(it: DemoItem) {
  const base = 6.5 + ((it.hue % 35) / 35) * 3.2; // 6.5–9.7
  return {
    rating: Math.round(base * 10) / 10,
    audienceRating: Math.round((base - 0.4) * 10) / 10,
    contentRating: it.type === "movie" ? ["PG-13", "R", "PG"][it.hue % 3] : ["TV-MA", "TV-14"][it.hue % 2],
  };
}

/** Convert a demo item into a raw Plex metadata object the client can parse. */
function metadata(it: DemoItem): Record<string, unknown> {
  const r = ratingsFor(it);
  return {
    ratingKey: it.ratingKey,
    title: it.title,
    year: it.year,
    type: it.type,
    thumb: thumbPath(it.ratingKey),
    art: thumbPath(it.ratingKey),
    contentRating: r.contentRating,
    rating: r.rating,
    audienceRating: r.audienceRating,
    duration: 90 * 60 * 1000,
    addedAt: 1_700_000_000,
    librarySectionID: Number(it.sectionId),
    librarySectionTitle: it.sectionTitle,
    Media: [
      {
        videoResolution: it.videoResolution,
        videoCodec: it.videoCodec,
        audioCodec: it.audioCodec,
        audioChannels: it.audioChannels,
        container: it.container,
        width: it.videoResolution === "4k" ? 3840 : 1920,
        height: it.videoResolution === "4k" ? 2160 : 1080,
        Part: [{ container: it.container, audioProfile: it.audioCodec, Stream: [{ streamType: 1, bitDepth: 10 }] }],
      },
    ],
  };
}

function sectionItems(sectionId: string, offset: number, size: number) {
  const all = ITEMS.filter((i) => i.sectionId === sectionId);
  const page = all.slice(offset, offset + size).map(metadata);
  return { totalSize: all.length, size: page.length, Metadata: page };
}

function metadataForKeys(keys: string[]) {
  // Collections share the metadata endpoint with items — the collection-detail
  // page looks one up by rating key exactly like an item.
  const metas = keys
    .map((k) => {
      const item = ITEM_BY_KEY.get(k);
      if (item) return metadata(item);
      const collection = COLLECTION_BY_KEY.get(k);
      return collection ? collectionMetadata(collection) : null;
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  return { size: metas.length, Metadata: metas };
}

/** Build a few home hubs from the demo collections so Preview has rows. */
function homeHubs() {
  const recent = ITEMS.filter((i) => i.sectionId === "1").slice(0, 9);
  const hubs: Array<Record<string, unknown>> = [
    {
      hubKey: "/hubs/home/recentlyAdded",
      hubIdentifier: "home.recentlyAdded",
      title: "Recently Added",
      type: "movie",
      Metadata: recent.map((i) => metadata(i)),
    },
  ];
  for (const c of COLLECTIONS.slice(0, 5)) {
    const items = c.itemRatingKeys
      .map((k) => ITEM_BY_KEY.get(k))
      .filter((x): x is DemoItem => Boolean(x))
      .map(metadata);
    hubs.push({
      hubKey: `/hubs/sections/${c.sectionId}/collection/${c.ratingKey}`,
      hubIdentifier: `custom.collection.${c.sectionId}.${c.ratingKey}.${c.ratingKey}`,
      title: c.title,
      type: c.sectionId === "1" ? "movie" : "show",
      Metadata: items,
    });
  }
  return hubs;
}

/**
 * A section's collections as manage-hub rows, the first two of each pinned.
 *
 * Two rather than all of them, deliberately: the Pinned column is only worth
 * having because it distinguishes, and a demo where every row says "Pinned"
 * demonstrates the opposite of what the column is for.
 *
 * The identifier is the canonical two-segment form the manage endpoint uses —
 * `custom.collection.{sectionId}.{ratingKey}` — not the four-segment one
 * `/hubs` reports, which `normalizeManageHubIdentifier` exists to reconcile.
 */
function managedHubs(sectionId: string): Array<Record<string, unknown>> {
  const inSection = COLLECTIONS.filter((c) => c.sectionId === sectionId);
  return inSection.map((c, i) => ({
    identifier: `custom.collection.${c.sectionId}.${c.ratingKey}`,
    title: c.title,
    promotedToOwnHome: i < 2 ? 1 : 0,
    promotedToRecommended: i < 2 ? 1 : 0,
    promotedToSharedHome: 0,
  }));
}

function ratingKeyFromPath(path: string): string | null {
  const m = path.match(/\/library\/metadata\/([\d,]+)/);
  return m ? m[1] : null;
}

function isImageRequest(path: string, query: URLSearchParams): boolean {
  if (/\/thumb\/|\/art\/|\/poster/.test(path)) return true;
  if (path.startsWith("/photo/")) return true;
  const inner = query.get("url");
  return inner ? /\/thumb\/|\/art\//.test(inner) : false;
}

function json(res: import("node:http").ServerResponse, container: Record<string, unknown>) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ MediaContainer: { size: 0, ...container } }));
}

export interface MockPlex {
  server: Server;
  origin: string;
  close: () => Promise<void>;
}

export function startMockPlex(port: number, host = "127.0.0.1"): Promise<MockPlex> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    const path = url.pathname;
    const q = url.searchParams;

    try {
      // ── Images ──────────────────────────────────────────────────────────
      if (isImageRequest(path, q)) {
        const inner = q.get("url");
        const key = ratingKeyFromPath(inner ?? path)?.split(",")[0] ?? null;
        const meta = key ? ITEM_BY_RATING_KEY[key] : undefined;
        const png = await poster(meta?.title ?? "Untitled", meta?.hue ?? 220);
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
        res.end(png);
        return;
      }

      // ── Home hubs (Preview page) ────────────────────────────────────────
      if (path === "/hubs") {
        json(res, { Hub: homeHubs() });
        return;
      }

      // ── Managed hubs (which collections are pinned) ─────────────────────
      // Answered for real rather than falling through to the empty container:
      // "pinned" is a column on the list and the primary verb on the detail
      // page, and a demo where nothing is ever pinned never shows either.
      const manageMatch = path.match(/^\/hubs\/sections\/(\w+)\/manage$/);
      if (manageMatch) {
        json(res, { Hub: managedHubs(manageMatch[1]) });
        return;
      }

      // ── Section items (Overlays sample, list scans) ─────────────────────
      const sectionAll = path.match(/^\/library\/sections\/(\w+)\/all$/);
      if (sectionAll) {
        const offset = Number(q.get("X-Plex-Container-Start") ?? "0");
        const size = Number(q.get("X-Plex-Container-Size") ?? "20");
        json(res, sectionItems(sectionAll[1], offset, size));
        return;
      }

      // ── Collection children (non-smart collection detail) ───────────────
      const childrenMatch = path.match(/^\/library\/metadata\/(\d+)\/children$/);
      if (childrenMatch) {
        const collection = COLLECTION_BY_KEY.get(childrenMatch[1]);
        json(res, collection ? collectionChildren(collection) : { size: 0, Metadata: [] });
        return;
      }

      // ── Metadata by rating key(s) (Overlays canvas + badges) ────────────
      const metaMatch = path.match(/^\/library\/metadata\/([\d,]+)$/);
      if (metaMatch) {
        json(res, metadataForKeys(metaMatch[1].split(",")));
        return;
      }

      // ── Fallback: empty but valid container ─────────────────────────────
      json(res, { Metadata: [], Directory: [], Hub: [] });
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(String(err));
    }
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      resolve({
        server,
        origin: `http://${host}:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
