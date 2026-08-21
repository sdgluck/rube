/**
 * MDBList and Trakt, over real HTTP.
 *
 * Same reasoning as the mock Plex and the mock *Arrs: the interesting failures
 * in these two clients are on the wire. Specifically —
 *
 * - **MDBList reports failure with HTTP 200 and an `error` field.** A `fetch`
 *   stub returning a happy object cannot exercise that path at all, and the
 *   failure it hides looks exactly like an empty list.
 * - **Both paginate, and both signal the end with a short page.** A stub that
 *   returns one array agrees that the walk terminates. This one hands back
 *   real pages, so an off-by-one in the offset shows up as a duplicate or a
 *   missing title rather than as nothing.
 * - **Reference parsing is the whole point of `mdblistListPath` and
 *   `traktListPath`.** The journal records the path each request actually went
 *   to, so a test can assert where a pasted URL was addressed rather than
 *   trusting that it was assembled correctly.
 *
 * These are models, not the real services. They can tell you the client is
 * internally consistent with the shapes recorded here; they cannot tell you
 * what MDBList accepts today.
 */
import { createServer, type Server } from "node:http";

export interface MockListSummary {
  id: number;
  name: string;
  slug?: string;
  /** MDBList's `user_name`, Trakt's `user.username`. */
  owner?: string;
  description?: string;
  mediaType?: "movie" | "show";
  itemCount?: number;
  likes?: number;
}

export interface MockListItem {
  title: string;
  year?: number | null;
  mediaType: "movie" | "show";
  imdbId?: string | null;
  tmdbId?: number | null;
}

export interface ListJournal {
  /** `METHOD path?query` for every request, in order. */
  requests: string[];
  /** The `query` parameter of every search, so encoding can be asserted. */
  searches: string[];
  unhandled: string[];
}

export interface MockListServer {
  origin: string;
  journal: ListJournal;
  /** Lists by id, and by `owner/slug` for the reference forms that use it. */
  lists: Map<string, { summary: MockListSummary; items: MockListItem[] }>;
  /** What a search answers with. Defaults to every list the server holds. */
  setSearchResults: (results: MockListSummary[] | null) => void;
  /** Fail the next `n` requests with `status` before behaving normally again. */
  failNext: (n: number, status?: number, body?: string) => void;
  close: () => Promise<void>;
}

export interface MockListEntry {
  summary: MockListSummary;
  items?: MockListItem[];
  /** Extra keys this list also answers to — `owner/slug`, a numeric alias. */
  aliases?: string[];
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function start(service: "mdblist" | "trakt", entries: MockListEntry[]): Promise<MockListServer> {
  const lists = new Map<string, { summary: MockListSummary; items: MockListItem[] }>();
  for (const entry of entries) {
    const record = { summary: entry.summary, items: entry.items ?? [] };
    lists.set(String(entry.summary.id), record);
    if (entry.summary.slug && entry.summary.owner) {
      lists.set(`${entry.summary.owner}/${entry.summary.slug}`, record);
    }
    for (const alias of entry.aliases ?? []) lists.set(alias, record);
  }

  const journal: ListJournal = { requests: [], searches: [], unhandled: [] };
  let searchResults: MockListSummary[] | null = null;
  let failuresRemaining = 0;
  let failureStatus = 500;
  let failureBody = "";

  const mdblistSummary = (l: MockListSummary) => ({
    id: l.id,
    user_id: 1,
    user_name: l.owner ?? "",
    name: l.name,
    slug: l.slug ?? "",
    description: l.description ?? "",
    mediatype: l.mediaType ?? "movie",
    items: l.itemCount ?? 0,
    likes: l.likes ?? 0,
  });

  const traktSummary = (l: MockListSummary) => ({
    list: {
      name: l.name,
      description: l.description ?? "",
      privacy: "public",
      item_count: l.itemCount ?? 0,
      likes: l.likes ?? 0,
      ids: { trakt: l.id, slug: l.slug ?? "" },
      user: { username: l.owner ?? "" },
    },
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const path = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();
    journal.requests.push(`${method} ${path}${url.search}`);

    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (failuresRemaining > 0) {
      failuresRemaining--;
      res.writeHead(failureStatus, { "Content-Type": "application/json" });
      res.end(failureBody);
      return;
    }

    const all = [...new Set(lists.values())].map((r) => r.summary);

    // ── Search and browse ───────────────────────────────────────────────────
    if (path === "/lists/search" || path === "/search/list") {
      journal.searches.push(url.searchParams.get("query") ?? "");
      const results = searchResults ?? all;
      json(service === "mdblist" ? results.map(mdblistSummary) : results.map(traktSummary));
      return;
    }

    if (path === "/lists/top" || path === "/lists/trending") {
      const results = searchResults ?? all;
      json(service === "mdblist" ? results.map(mdblistSummary) : results.map(traktSummary));
      return;
    }

    // ── One list ────────────────────────────────────────────────────────────
    // The reference forms both clients build: `/lists/<id>`,
    // `/lists/<user>/<slug>` (MDBList) and `/users/<user>/lists/<slug>`
    // (Trakt), each optionally followed by `/items`.
    const items = path.endsWith("/items");
    const base = items ? path.slice(0, -"/items".length) : path;
    const key = base
      .replace(/^\/lists\//, "")
      .replace(/^\/users\//, "")
      .replace(/\/lists\//, "/");
    const record = lists.get(decodeURIComponent(key)) ?? lists.get(key);

    if (!record) {
      journal.unhandled.push(`${method} ${path}`);
      json({ error: "list not found" }, service === "mdblist" ? 200 : 404);
      return;
    }

    if (!items) {
      // MDBList answers with a one-element array here, Trakt with an object.
      // Getting this wrong yields an undefined name rather than an error, so
      // both shapes are modelled exactly.
      json(service === "mdblist" ? [mdblistSummary(record.summary)] : traktSummary(record.summary).list);
      return;
    }

    if (service === "mdblist") {
      const limit = Number(url.searchParams.get("limit")) || record.items.length;
      const offset = Number(url.searchParams.get("offset")) || 0;
      const page = record.items.slice(offset, offset + limit);
      json({
        movies: page
          .filter((i) => i.mediaType === "movie")
          .map((i) => ({
            id: i.tmdbId ?? null,
            title: i.title,
            imdb_id: i.imdbId ?? null,
            release_year: i.year ?? null,
            mediatype: "movie",
          })),
        shows: page
          .filter((i) => i.mediaType === "show")
          .map((i) => ({
            id: i.tmdbId ?? null,
            title: i.title,
            imdb_id: i.imdbId ?? null,
            release_year: i.year ?? null,
            mediatype: "show",
          })),
      });
      return;
    }

    const limit = Number(url.searchParams.get("limit")) || record.items.length;
    const pageNumber = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const page = record.items.slice((pageNumber - 1) * limit, pageNumber * limit);
    json(
      page.map((i) => ({
        type: i.mediaType,
        [i.mediaType]: {
          title: i.title,
          year: i.year ?? null,
          ids: { trakt: 1, imdb: i.imdbId ?? null, tmdb: i.tmdbId ?? null },
        },
      })),
    );
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        journal,
        lists,
        setSearchResults(results) {
          searchResults = results;
        },
        failNext(n, status = 500, body = "") {
          failuresRemaining = n;
          failureStatus = status;
          failureBody = body;
        },
        close: () => closeServer(server),
      });
    });
  });
}

export function startMockMdblist(entries: MockListEntry[]): Promise<MockListServer> {
  return start("mdblist", entries);
}

export function startMockTrakt(entries: MockListEntry[]): Promise<MockListServer> {
  return start("trakt", entries);
}
