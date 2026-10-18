/**
 * A stateful Plex Media Server, over real HTTP.
 *
 * Deliberately not a `fetch` stub. The stubs elsewhere in this package let the
 * job's own logic be tested cheaply, but they short-circuit everything between
 * the call site and the wire: URL construction, parameter encoding, which
 * endpoint a mutation is addressed to, and how a response is parsed. Two of the
 * bugs in this feature lived exactly there — a label PUT sent to the wrong
 * path, and a 200 with an empty body parsed as JSON — and a stub would have
 * agreed with both.
 *
 * So this speaks HTTP, holds real state, and mutates it: a collection created
 * by the job is afterwards listable, labelled, and deletable, and an item the
 * job deletes is gone from the next section listing.
 *
 * It is a model of Plex, not Plex. It cannot tell you what the real server
 * accepts — only that the code is internally consistent with the shape
 * documented here. Endpoint semantics still need one pass against a real
 * server.
 */
import { createServer, type Server } from "node:http";

export const MACHINE_ID = "mock-machine-id";

/**
 * A real 12×18 teal PNG, served for every `/thumb/` path.
 *
 * Committed as bytes rather than generated with `sharp` at start-up so the
 * mock stays a plain HTTP server with no image dependency — and so a test that
 * fails does so in the code under test rather than in the fixture.
 */
const THUMB_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAwAAAASCAIAAADgy6hbAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFElEQVR42mNgaO4njEYVjSqityIAVPbnMfnl0N4AAAAASUVORK5CYII=",
  "base64",
);

/** Plex's numeric type for a collection, as the client sends it. */
const COLLECTION_TYPE = 18;

export interface MockItem {
  ratingKey: string;
  title: string;
  sectionId: string;
  /** Provider ids, as Plex serves them: `tmdb://603`. */
  guids: string[];
  labels: string[];
  /** Arbitrary field the mock can filter on, standing in for a real facet. */
  genre?: string;
  year?: number;
  /**
   * Audio track languages, served as `Media[].Part[].Stream[]`.
   *
   * The reason this exists: a grouped rule buckets an item once per language,
   * so a film with three audio tracks is yielded three times in a single run.
   * That is the shape that made the ledger double-count, and it can only be
   * reproduced by an item that genuinely has several.
   */
  audioLanguages?: string[];
  /**
   * Artwork path. Present on an item makes it usable as member art for a
   * generated collection poster — see the `/thumb/` route, which serves real
   * PNG bytes so `sharp` has something it can genuinely decode.
   */
  thumb?: string;
  /**
   * Watch state, as Plex serves it. Both matter to the stress harness, which
   * refuses to touch anything already watched: a *finished* item has a view
   * count and no offset, so filtering on `viewOffset` alone silently admits it.
   */
  viewCount?: number;
  viewOffset?: number;
  /** Runtime in ms, reported on the item and used for timeline reports. */
  duration?: number;
}

/**
 * A TV show with episodes, for the episode-ordering checks.
 *
 * Kept apart from `MockItem` because nothing else here models the show →
 * episode tree, and the rules tests that use `MockItem` should not have to
 * know about it.
 */
export interface MockShow {
  ratingKey: string;
  title: string;
  sectionId: string;
  /** The agent's own id. Defaults to a modern-agent `plex://show/…`. */
  guid?: string;
  /** The show's own `showOrdering`; absent means it follows the library. */
  ordering?: string;
  episodes: Array<{ season: number; episode: number; title: string; file: string }>;
}

export interface MockCollection {
  ratingKey: string;
  title: string;
  sectionId: string;
  labels: string[];
  memberKeys: string[];
  /** Description, as Plex serves it and as `PUT ?summary=` sets it. */
  summary?: string;
  /** Artwork path. Plex mints a new one on every upload; so does this. */
  thumb?: string;
}

export interface MockSection {
  key: string;
  title: string;
  type: string;
}

/** Everything the job did, in order — the assertions read this. */
export interface PlexJournal {
  deletedItems: string[];
  deletedCollections: string[];
  createdCollections: Array<{ title: string; sectionId: string; memberKeys: string[] }>;
  /** `{ ratingKey, labels }` for every tag write, whichever endpoint carried it — the labels it was left with. */
  labelWrites: Array<{ ratingKey: string; labels: string[] }>;
  /** One entry per label PUT to a section, with every id it named — so a test can see batching. */
  labelWriteRequests: Array<{ ids: string[] }>;
  /** Label values the job narrowed a collection listing by, server-side. */
  labelFilteredListings: string[];
  /** Every summary written onto a collection, in order. */
  summaryWrites: Array<{ ratingKey: string; summary: string }>;
  /** Every poster upload, with the byte count that arrived. */
  posterUploads: Array<{ ratingKey: string; bytes: number }>;
  /** Members added to an existing collection, rather than created with one. */
  collectionItemAdds: Array<{ ratingKey: string; itemKeys: string[] }>;
  /** Members removed one at a time — Plex offers no bulk form. */
  collectionItemRemoves: Array<{ ratingKey: string; itemKey: string }>;
  /** Collections promoted to the homepage, and demoted from it. */
  pinned: string[];
  unpinned: string[];
  /** Whose Home each pin promoted to, in order — which person sees the row — and whether it went on Recommended. */
  pinHomes: Array<{ ratingKey: string; own: boolean; shared: boolean; recommended: boolean }>;
  /** Sessions registered through `/video/:/transcode/universal/decision`. */
  transcodeDecisions: string[];
  /** Transcode sessions started and stopped, by session id. */
  transcodeStarts: string[];
  transcodeStops: string[];
  /** Every `/:/timeline` report, in order. */
  timelines: Array<{ ratingKey: string; clientId: string; state: string }>;
  /** Every item the caller marked unwatched. The stress harness undoing its own
   *  history is only correct if this contains nothing it did not first watch. */
  unscrobbled: string[];
  /** Stream/segment fetches, by client. */
  streamFetches: Array<{ clientId: string; path: string }>;
  /**
   * Writes to shows, in order: a pref PUT, a metadata refresh, an analysis.
   * Order is the point — an ordering change is only seen after a refresh.
   */
  showWrites: Array<{ ratingKey: string; action: "prefs" | "refresh" | "analyze"; params?: Record<string, string> }>;
  /** Partial scans, one per `GET /library/sections/:id/refresh?path=`. */
  pathScans: Array<{ sectionId: string; path: string }>;
  /** Paths that arrived at an endpoint this mock does not implement. */
  unhandled: string[];
}

/** One play in `/status/sessions/history/all`. */
export interface MockHistoryEntry {
  ratingKey: string;
  title: string;
  year?: number;
  type: "movie" | "episode";
  librarySectionID: string;
  /** The server-local account it was played on; unset matches any `accountID` filter's absence only. */
  accountID?: string;
  grandparentRatingKey?: string;
  grandparentTitle?: string;
}

export interface MockPlex {
  origin: string;
  journal: PlexJournal;
  items: Map<string, MockItem>;
  collections: Map<string, MockCollection>;
  /** Shows, mutable by a test to model a refresh that renumbered them. */
  shows: Map<string, MockShow>;
  /** Each library's default `showOrdering`, as its prefs report it. Unset reads as `tmdbAiring`. */
  sectionOrderings: Map<string, string>;
  /**
   * Server preferences, as `/:/prefs` serves them and `PUT /:/prefs?id=value`
   * sets them — which is how the preroll path list reaches Plex. Every write is
   * stored, known id or not, because that is what Plex does too.
   */
  prefs: Map<string, string>;
  /**
   * Watch history, newest first, mutable by a test. Served filtered by
   * `librarySectionID` and `accountID` the way Plex filters it, because
   * Because You Watched reads history live rather than from the local index.
   */
  history: MockHistoryEntry[];
  /**
   * Playback knobs for the stress harness.
   *
   * Both are expressed in terms of *how many sessions are live*, so a test says
   * "this server falls over at four streams" and gets the same answer every
   * run. Wall-clock triggers would make these tests a race against the ramp.
   *
   * `transcodeSpeed` is what `/status/sessions` reports for each live session.
   * `capacity` caps how many sessions the listing admits to — a server that has
   * quietly killed the rest, which is the only signal a direct-play run has.
   */
  playback: {
    transcodeSpeed: number | ((liveSessions: number) => number);
    bandwidth: number;
    capacity: number | null;
    /**
     * Model the real server's contract: a session that was never registered
     * through `/video/:/transcode/universal/decision` is a throwaway, and is
     * discarded as soon as another transcode starts — its playlist then 404s.
     *
     * On by default, because it is what a real Plex server does and it is the
     * only thing that makes a missing `decision` call visible in a test. One
     * session works fine without it; the bug only appears at two.
     */
    requireTranscodeDecision: boolean;
    /** Sessions currently reporting a timeline, keyed by client id. */
    sessions: Map<string, { ratingKey: string; clientId: string }>;
    /**
     * Fail the next N `/status/sessions` calls.
     *
     * A 500 rather than a 503: 503 is in the client's retryable set, so it is
     * transparently retried and never reaches the harness as a failed reading,
     * which is the thing under test.
     *
     * A stress run samples this endpoint continuously and treats a failure as
     * "we have lost the ability to measure" rather than as an error to abort
     * on — a distinction with its own branch in `assessStep` and its own colour
     * on the chart, and one that needs a way to actually occur in a test.
     */
    failSessionsFor: number;
  };
  /**
   * Answer `METHOD path` with this status, as Plex's bare HTML error page,
   * until cleared with `null`. For the states a real server gets into that
   * the model can't reach on its own — a collection it lists but 404s on
   * read, or one that refuses (400) any item added to it.
   */
  failWith: (method: string, path: string, status: number | null, opts?: { after?: number }) => void;
  close: () => Promise<void>;
}

export function startMockPlex(opts: {
  sections: MockSection[];
  items: MockItem[];
  shows?: MockShow[];
  /** What the identity root reports as `myPlexSubscription`. Absent by default, as on a free server. */
  plexPass?: boolean;
}): Promise<MockPlex> {
  const items = new Map(opts.items.map((i) => [i.ratingKey, { ...i, labels: [...i.labels] }]));
  const collections = new Map<string, MockCollection>();
  const prefs = new Map<string, string>();
  const shows = new Map((opts.shows ?? []).map((s) => [s.ratingKey, { ...s, episodes: [...s.episodes] }]));
  const sectionOrderings = new Map<string, string>();
  const history: MockHistoryEntry[] = [];
  const journal: PlexJournal = {
    deletedItems: [],
    deletedCollections: [],
    createdCollections: [],
    labelWrites: [],
    labelWriteRequests: [],
    labelFilteredListings: [],
    summaryWrites: [],
    posterUploads: [],
    collectionItemAdds: [],
    collectionItemRemoves: [],
    transcodeDecisions: [],
    transcodeStarts: [],
    transcodeStops: [],
    timelines: [],
    unscrobbled: [],
    streamFetches: [],
    pinned: [],
    unpinned: [],
    pinHomes: [],
    showWrites: [],
    pathScans: [],
    unhandled: [],
  };
  /** Which collections are on the homepage, per section. */
  const pinnedBySection = new Map<string, Set<string>>();
  /** The last promotion each pinned row was given, so the manage listing reports it back. */
  const hubFlags = new Map<string, { own: boolean; shared: boolean; recommended: boolean }>();
  let nextCollectionKey = 9000;
  let nextThumbVersion = 1;
  const sessions = new Map<string, { ratingKey: string; clientId: string }>();
  const liveTranscodes = new Set<string>();
  const deadTranscodes = new Set<string>();
  const decidedSessions = new Set<string>();
  const playback: MockPlex["playback"] = {
    transcodeSpeed: 2.5,
    bandwidth: 8000,
    capacity: null,
    failSessionsFor: 0,
    requireTranscodeDecision: true,
    sessions,
  };

  /** `after` counts down the calls still allowed through — "it was there, then it wasn't". */
  const forcedFailures = new Map<string, { status: number; after: number }>();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const path = url.pathname;
    const q = url.searchParams;
    const method = (req.method ?? "GET").toUpperCase();

    const forced = forcedFailures.get(`${method} ${path}`);
    if (forced && forced.after > 0) forced.after--;
    else if (forced) {
      res.writeHead(forced.status, { "Content-Type": "text/html" });
      res.end(`<html><head><title>Error</title></head><body><h1>${forced.status}</h1></body></html>`);
      return;
    }

    const json = (body: unknown) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ MediaContainer: body }));
    };
    /** Plex answers some mutations with 200 and no body at all. */
    const emptyOk = () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end();
    };
    const notFound = () => {
      res.writeHead(404);
      res.end();
    };

    // ── Identity ────────────────────────────────────────────────────────────
    if (path === "/") {
      json({
        friendlyName: "Mock Plex",
        machineIdentifier: MACHINE_ID,
        ...(opts.plexPass === undefined ? {} : { myPlexSubscription: opts.plexPass }),
      });
      return;
    }

    // ── Section directory ───────────────────────────────────────────────────
    if (path === "/library/sections") {
      json({ Directory: opts.sections });
      return;
    }

    // Empty is enough: the recently-added job is tested for what it does
    // besides caching this list (labelling new arrivals), not for the list.
    if (path === "/library/recentlyAdded") {
      json({ Metadata: [] });
      return;
    }

    // ── Tag writes and section listings ─────────────────────────────────────
    // A facet's values: `/library/sections/1/genre`. Only `genre` is modelled,
    // from the items' own genres; any other facet 404s, as a real server does
    // for one the section's type doesn't have.
    const facet = path.match(/^\/library\/sections\/([^/]+)\/([a-zA-Z]+)$/);
    if (facet && method === "GET" && !["all", "refresh", "prefs", "collections", "label"].includes(facet[2])) {
      if (facet[2] !== "genre") {
        res.writeHead(404);
        res.end();
        return;
      }
      const genres = [
        ...new Set([...items.values()].filter((i) => i.sectionId === facet[1] && i.genre).map((i) => i.genre!)),
      ];
      json({ size: genres.length, Directory: genres.map((title, i) => ({ key: String(1000 + i), title })) });
      return;
    }

    const sectionAll = path.match(/^\/library\/sections\/([^/]+)\/all$/);
    if (sectionAll) {
      const sectionId = sectionAll[1];

      // Plex's tag editor for a library item: PUT to the section with `type`
      // and `id`, where `id` may be a comma-separated batch. Modelled on what a
      // real server did (2026-10): `label[N].tag.tag` *adds* to an item's
      // labels, `label[].tag.tag-=a,b` removes, and an empty `label[].tag.tag=`
      // clears. A mock that replaced the set would pass code that relies on
      // omission to remove — which real Plex ignores.
      if (method === "PUT") {
        const ids = (q.get("id") ?? "").split(",").filter(Boolean);
        const added: string[] = [];
        for (const [k, v] of q) if (/^label\[\d+]\.tag\.tag$/.test(k)) added.push(v);
        const removed = new Set(
          q
            .getAll("label[].tag.tag-")
            .flatMap((v) => v.split(","))
            .map((v) => v.toLowerCase()),
        );
        const clear = q.get("label[].tag.tag") === "";
        if (ids.length === 0) {
          journal.unhandled.push(`PUT ${path} with no id`);
          notFound();
          return;
        }
        journal.labelWriteRequests.push({ ids });
        for (const id of ids) {
          const item = items.get(id);
          if (item) {
            const next = clear ? [] : [...item.labels];
            for (const label of added) {
              if (!next.some((l) => l.toLowerCase() === label.toLowerCase())) next.push(label);
            }
            item.labels = next.filter((l) => !removed.has(l.toLowerCase()));
            journal.labelWrites.push({ ratingKey: id, labels: item.labels });
          }
          // Collections keep replace semantics: their label writes go through
          // `/library/metadata/:key`, which nothing here has checked against a
          // real server, so the mock doesn't claim to know better.
          const collection = collections.get(id);
          if (collection) {
            collection.labels = added;
            journal.labelWrites.push({ ratingKey: id, labels: added });
          }
        }
        emptyOk();
        return;
      }

      // type=2 asks a TV section for its shows. Plex carries `showOrdering`
      // on the row only when the show overrides its library (checked against
      // 1.42), so the mock leaves it off otherwise.
      if (q.get("type") === "2") {
        const rows = [...shows.values()]
          .filter((s) => s.sectionId === sectionId)
          .map((s) => ({
            ratingKey: s.ratingKey,
            title: s.title,
            type: "show",
            guid: s.guid ?? `plex://show/${s.ratingKey}`,
            leafCount: s.episodes.length,
            ...(s.ordering ? { showOrdering: s.ordering } : {}),
          }));
        const start = Number(q.get("X-Plex-Container-Start") ?? "0");
        const size = Number(q.get("X-Plex-Container-Size") ?? String(rows.length));
        json({ size: rows.length, totalSize: rows.length, Metadata: rows.slice(start, start + size) });
        return;
      }

      // A listing of type=18 is asking for the section's collections.
      if (q.get("type") === String(COLLECTION_TYPE)) {
        // `label=` narrows the listing server-side. Honoured here so the mock
        // models the contract the client now relies on for speed, rather than
        // returning everything and passing only because the client re-checks
        // labels afterwards.
        const wantLabel = q.get("label");
        if (wantLabel) journal.labelFilteredListings.push(wantLabel);
        const rows = [...collections.values()]
          .filter((c) => c.sectionId === sectionId)
          .filter((c) => !wantLabel || c.labels.some((l) => l.toLowerCase() === wantLabel.toLowerCase()))
          // Deliberately no `Label` on the row. Real Plex does not carry labels
          // in a collection listing (checked against 1.42), so the client's
          // per-collection fallback is the path that actually runs.
          .map((c) => ({ ratingKey: c.ratingKey, title: c.title, childCount: c.memberKeys.length }));
        json({ size: rows.length, totalSize: rows.length, Metadata: rows });
        return;
      }

      // Otherwise it's an item query. `genre` and `label` / `label!` are the
      // facets this mock filters on — enough for a rule to select a deliberate
      // subset, and for a label pass to touch only what it must.
      let matched = [...items.values()].filter((i) => i.sectionId === sectionId);
      const genre = q.get("genre");
      if (genre) matched = matched.filter((i) => i.genre === genre);
      const hasLabel = (i: MockItem, l: string) => i.labels.some((x) => x.toLowerCase() === l.toLowerCase());
      const withLabel = q.get("label");
      if (withLabel) matched = matched.filter((i) => hasLabel(i, withLabel));
      const withoutLabel = q.get("label!");
      if (withoutLabel) matched = matched.filter((i) => !hasLabel(i, withoutLabel));

      const start = Number(q.get("X-Plex-Container-Start") ?? "0");
      const sizeParam = q.get("X-Plex-Container-Size");
      const size = sizeParam == null ? matched.length : Number(sizeParam);
      const page = matched.slice(start, start + size);
      json({
        size: page.length,
        totalSize: matched.length,
        // No `Label` on listing rows: a real server's section listing leaves
        // it off entirely, so labels are only learnt from item detail or from
        // a `label=` listing.
        Metadata: page.map((i) => {
          const { Label: _, ...row } = metadataFor(i);
          return row;
        }),
      });
      return;
    }

    // A library's own prefs. Only `showOrdering` is modelled, in the library
    // vocabulary, where TheTVDB's aired order is spelled `aired`.
    const sectionPrefs = path.match(/^\/library\/sections\/([^/]+)\/prefs$/);
    if (sectionPrefs) {
      json({
        Setting: [{ id: "showOrdering", value: sectionOrderings.get(sectionPrefs[1]) ?? "tmdbAiring" }],
      });
      return;
    }

    const sectionRefresh = path.match(/^\/library\/sections\/([^/]+)\/refresh$/);
    if (sectionRefresh) {
      journal.pathScans.push({ sectionId: sectionRefresh[1], path: q.get("path") ?? "" });
      emptyOk();
      return;
    }

    // The label directory. Plex serves the same server-wide list under every
    // section; keyed by title here, which `label=` also accepts.
    if (/^\/library\/sections\/[^/]+\/label$/.test(path)) {
      const titles = new Map<string, string>();
      for (const i of items.values()) for (const l of i.labels) titles.set(l.toLowerCase(), l);
      json({ Directory: [...titles.values()].map((title) => ({ key: title, title })) });
      return;
    }

    // ── Collection creation ─────────────────────────────────────────────────
    if (path === "/library/collections" && method === "POST") {
      const title = q.get("title") ?? "";
      const sectionId = q.get("sectionId") ?? "";
      // The member list rides in the `uri` as a comma-joined key list.
      const uri = q.get("uri") ?? "";
      const added = (uri.split("/library/metadata/")[1] ?? "").split(",").filter(Boolean);
      // Plex keeps membership as a tag on each item, named by the title: a
      // second collection with a title already used in this library is a
      // second view of the *same* items, not a new set. Modelled by sharing
      // the array itself, so adds, removes and the delete below reach every
      // collection of that title — the behaviour that pooled twelve people's
      // "We Think You'd Like" rows into one.
      const sameTitle = [...collections.values()].find((c) => c.sectionId === sectionId && c.title === title);
      const memberKeys = sameTitle?.memberKeys ?? [];
      for (const key of added) if (!memberKeys.includes(key)) memberKeys.push(key);
      const ratingKey = String(nextCollectionKey++);
      collections.set(ratingKey, { ratingKey, title, sectionId, labels: [], memberKeys });
      journal.createdCollections.push({ title, sectionId, memberKeys: added });
      json({ Metadata: [{ ratingKey }] });
      return;
    }

    // ── Artwork bytes ───────────────────────────────────────────────────────
    // Real PNG bytes, not a placeholder: the poster renderer hands whatever
    // comes back to `sharp`, so a stub body would fail at the decoder rather
    // than exercising the path under test.
    if (/^\/library\/metadata\/[^/]+\/thumb\//.test(path)) {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(THUMB_PNG);
      return;
    }

    // ── Artwork upload ──────────────────────────────────────────────────────
    // Plex takes the image bytes as the raw request body and mints a fresh
    // `thumb` path for them. The new path is what makes "did this run replace
    // the artwork?" answerable from the next metadata read.
    const posters = path.match(/^\/library\/metadata\/([^/]+)\/posters$/);
    if (posters && method === "POST") {
      const key = posters[1];
      let bytes = 0;
      req.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
      });
      req.on("end", () => {
        journal.posterUploads.push({ ratingKey: key, bytes });
        const collection = collections.get(key);
        if (collection) collection.thumb = `/library/metadata/${key}/thumb/${nextThumbVersion++}`;
        emptyOk();
      });
      return;
    }

    // ── Shows ───────────────────────────────────────────────────────────────
    const showAction = path.match(/^\/library\/metadata\/([^/]+)\/(allLeaves|prefs|refresh|analyze)$/);
    if (showAction && shows.has(showAction[1])) {
      const show = shows.get(showAction[1]) as MockShow;
      const action = showAction[2];
      if (action === "allLeaves") {
        json({
          size: show.episodes.length,
          Metadata: show.episodes.map((e, i) => ({
            ratingKey: `${show.ratingKey}-${i}`,
            type: "episode",
            title: e.title,
            parentIndex: e.season,
            index: e.episode,
            Media: [{ Part: [{ key: `/library/parts/${show.ratingKey}-${i}/file.mkv`, file: e.file }] }],
          })),
        });
        return;
      }
      // A real server 404s a GET here; only the PUT is meaningful.
      if (action === "prefs" && method === "PUT") {
        const params = Object.fromEntries(q);
        if (params.showOrdering !== undefined) show.ordering = params.showOrdering || undefined;
        journal.showWrites.push({ ratingKey: show.ratingKey, action: "prefs", params });
        emptyOk();
        return;
      }
      if ((action === "refresh" || action === "analyze") && method === "PUT") {
        journal.showWrites.push({ ratingKey: show.ratingKey, action });
        emptyOk();
        return;
      }
      notFound();
      return;
    }

    // ── Collection members ──────────────────────────────────────────────────
    const children = path.match(/^\/library\/metadata\/([^/]+)\/children$/);
    if (children) {
      const collection = collections.get(children[1]);
      if (!collection) {
        notFound();
        return;
      }
      const rows = collection.memberKeys.map((k) => items.get(k)).filter((i): i is MockItem => !!i);
      json({ size: rows.length, Metadata: rows.map(metadataFor) });
      return;
    }

    // ── Item / collection metadata, and deletion ────────────────────────────
    const metadata = path.match(/^\/library\/metadata\/([^/]+)$/);
    if (metadata) {
      const key = metadata[1];
      const item = items.get(key);
      const collection = collections.get(key);

      if (method === "DELETE") {
        if (item) {
          items.delete(key);
          journal.deletedItems.push(key);
          // Plex answers a delete with 200 and an empty body. Parsing that as
          // JSON is what broke `arrFetch`; the same shape is served here so the
          // Plex path can't regress the same way.
          emptyOk();
          return;
        }
        if (collection) {
          // Deleting a collection takes its tag off the items, which empties
          // every other collection sharing the title (see creation above).
          collection.memberKeys.length = 0;
          collections.delete(key);
          journal.deletedCollections.push(key);
          emptyOk();
          return;
        }
        notFound();
        return;
      }

      // Title/summary edits: `PUT /library/metadata/:key?summary=…`. Labels
      // sent here *replace* the collection's set — unlike the section form
      // above — as a real server did (2026-10).
      if (method === "PUT" && collection) {
        const labels: string[] = [];
        for (const [k, v] of q) if (/^label\[\d+]\.tag\.tag$/.test(k)) labels.push(v);
        if (labels.length > 0) collection.labels = labels;
        const summary = q.get("summary");
        const title = q.get("title");
        if (summary !== null) {
          collection.summary = summary;
          journal.summaryWrites.push({ ratingKey: key, summary });
        }
        if (title !== null) collection.title = title;
        emptyOk();
        return;
      }

      if (item) {
        json({ Metadata: [metadataFor(item)] });
        return;
      }
      if (collection) {
        json({
          Metadata: [
            {
              ratingKey: collection.ratingKey,
              title: collection.title,
              summary: collection.summary ?? "",
              smart: 0,
              thumb: collection.thumb ?? "",
              childCount: collection.memberKeys.length,
              Label: collection.labels.map((tag) => ({ tag })),
            },
          ],
        });
        return;
      }
      notFound();
      return;
    }

    // ── Collection membership, edited in place ──────────────────────────────
    // The endpoints reconciling depends on. `items` appends (the same PUT smart
    // collections use for their filter URI, which is why the client guards on
    // `smart` before calling it); `children/:key` removes exactly one.
    const addItems = path.match(/^\/library\/collections\/([^/]+)\/items$/);
    if (addItems && method === "PUT") {
      const collection = collections.get(addItems[1]);
      if (!collection) {
        notFound();
        return;
      }
      const uri = q.get("uri") ?? "";
      const itemKeys = (uri.split("/library/metadata/")[1] ?? "").split(",").filter(Boolean);
      // Re-adding an existing member is a no-op on Plex's side, not a duplicate.
      for (const key of itemKeys) {
        if (!collection.memberKeys.includes(key)) collection.memberKeys.push(key);
      }
      journal.collectionItemAdds.push({ ratingKey: collection.ratingKey, itemKeys });
      emptyOk();
      return;
    }

    const removeItem = path.match(/^\/library\/collections\/([^/]+)\/children\/([^/]+)$/);
    if (removeItem && method === "DELETE") {
      const collection = collections.get(removeItem[1]);
      const itemKey = removeItem[2];
      if (!collection || !collection.memberKeys.includes(itemKey)) {
        notFound();
        return;
      }
      // In place: the array may be shared with same-titled collections.
      collection.memberKeys.splice(collection.memberKeys.indexOf(itemKey), 1);
      journal.collectionItemRemoves.push({ ratingKey: collection.ratingKey, itemKey });
      emptyOk();
      return;
    }

    // ── The homepage ────────────────────────────────────────────────────────
    // Pinning is a POST to promote plus a PUT carrying the three `promotedTo*`
    // flags; unpinning is a DELETE against the same identifier. Reconciling
    // reads this listing to find out what is already pinned, so it has to
    // report state rather than just accept writes.
    const manageHub = path.match(/^\/hubs\/sections\/([^/]+)\/manage\/(.+)$/);
    if (manageHub) {
      const sectionId = manageHub[1];
      const ratingKey = manageHub[2].split(".").pop() ?? "";
      const pinnedHere = pinnedBySection.get(sectionId) ?? new Set<string>();
      if (method === "DELETE") {
        pinnedHere.delete(ratingKey);
        journal.unpinned.push(ratingKey);
      } else {
        pinnedHere.add(ratingKey);
        journal.pinned.push(ratingKey);
        // Plex's own spelling only: it ignores `promotedToRecommendedHome`,
        // which this code sent for years without anything noticing.
        const flags = {
          own: q.get("promotedToOwnHome") === "1",
          shared: q.get("promotedToSharedHome") === "1",
          recommended: q.get("promotedToRecommended") === "1",
        };
        hubFlags.set(ratingKey, flags);
        journal.pinHomes.push({ ratingKey, ...flags });
      }
      pinnedBySection.set(sectionId, pinnedHere);
      emptyOk();
      return;
    }

    const manageSection = path.match(/^\/hubs\/sections\/([^/]+)\/manage$/);
    if (manageSection) {
      const sectionId = manageSection[1];
      if (method === "POST") {
        // Promotion is a two-step dance; this half only makes the hub exist.
        emptyOk();
        return;
      }
      const keys = [...(pinnedBySection.get(sectionId) ?? [])];
      json({
        Hub: keys.map((key) => ({
          identifier: `custom.collection.${sectionId}.${key}`,
          title: collections.get(key)?.title ?? "",
          promotedToOwnHome: hubFlags.get(key)?.own ?? true,
          promotedToRecommended: hubFlags.get(key)?.recommended ?? true,
          promotedToSharedHome: hubFlags.get(key)?.shared ?? true,
        })),
      });
      return;
    }

    // ── Playback, for the stress harness ────────────────────────────────────
    // These stand in for a real transcoder. They are shaped from what the
    // harness actually sends, so a change in how it builds a URL shows up here
    // as a 404 rather than as a plausible-looking success.

    if (path === "/video/:/transcode/universal/start.m3u8") {
      const session = q.get("session") ?? "";
      journal.transcodeStarts.push(session);
      if (playback.requireTranscodeDecision) {
        // Sessions that never registered a decision are throwaways: the
        // arrival of a new transcode discards them.
        for (const prior of liveTranscodes) {
          if (!decidedSessions.has(prior)) deadTranscodes.add(prior);
        }
      }
      liveTranscodes.add(session);
      // A master playlist with an *absolute* variant URL, which is what real
      // Plex emits and what the harness used to mangle into
      // `/video/:/transcode/universal/http://…`.
      const origin = `http://${req.headers.host ?? "127.0.0.1"}`;
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end(
        "#EXTM3U\n" +
          "#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080\n" +
          `${origin}/video/:/transcode/universal/session/${session}/base/index.m3u8?session=${session}\n`,
      );
      return;
    }

    // What a client calls before `start.m3u8` to register the playback
    // decision. Skipping it is what made the harness's sessions evaporate.
    if (path === "/video/:/transcode/universal/decision") {
      const session = q.get("session") ?? "";
      decidedSessions.add(session);
      journal.transcodeDecisions.push(session);
      json({ size: 1, generalDecisionText: "Direct play not available; Conversion OK." });
      return;
    }

    if (path === "/video/:/transcode/universal/stop") {
      journal.transcodeStops.push(q.get("session") ?? "");
      emptyOk();
      return;
    }

    // The live media playlist. Segment names are *relative*, so resolving them
    // has to survive the query string this URL carries.
    if (path.endsWith("/base/index.m3u8")) {
      const owner = path.split("/session/")[1]?.split("/")[0] ?? "";
      if (deadTranscodes.has(owner)) {
        res.writeHead(404);
        res.end();
        return;
      }
      journal.streamFetches.push({ clientId: req.headers["x-plex-client-identifier"] as string, path });
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:5.0,\n00000.ts\n#EXTINF:5.0,\n00001.ts\n");
      return;
    }

    if (path.endsWith(".ts") || path.startsWith("/library/parts/")) {
      journal.streamFetches.push({ clientId: req.headers["x-plex-client-identifier"] as string, path });
      res.writeHead(200, { "Content-Type": "video/mp2t" });
      res.end(Buffer.alloc(4096));
      return;
    }

    if (path === "/:/timeline") {
      const clientId = (q.get("X-Plex-Client-Identifier") ?? req.headers["x-plex-client-identifier"]) as string;
      const ratingKey = q.get("ratingKey") ?? "";
      const state = q.get("state") ?? "";
      journal.timelines.push({ ratingKey, clientId, state });
      if (state === "stopped") sessions.delete(clientId);
      else sessions.set(clientId, { ratingKey, clientId });
      emptyOk();
      return;
    }

    if (path === "/status/sessions/history/all") {
      const section = url.searchParams.get("librarySectionID");
      const account = url.searchParams.get("accountID");
      const size = Number(url.searchParams.get("X-Plex-Container-Size") ?? history.length);
      const rows = history
        .filter((h) => (!section || h.librarySectionID === section) && (!account || h.accountID === account))
        .slice(0, size);
      json({ size: rows.length, Metadata: rows });
      return;
    }

    if (path === "/status/sessions") {
      if (playback.failSessionsFor > 0) {
        playback.failSessionsFor--;
        res.writeHead(500);
        res.end();
        return;
      }
      const all = [...sessions.values()];
      const live = playback.capacity == null ? all : all.slice(0, playback.capacity);
      const speed =
        typeof playback.transcodeSpeed === "function" ? playback.transcodeSpeed(all.length) : playback.transcodeSpeed;
      json({
        size: live.length,
        Metadata: live.map((s) => ({
          ratingKey: s.ratingKey,
          title: items.get(s.ratingKey)?.title ?? "",
          type: "movie",
          Player: { title: "Tinkerbell Stress Test", machineIdentifier: s.clientId, product: "tinkerbell-stress" },
          Session: { id: s.clientId, bandwidth: playback.bandwidth },
          TranscodeSession: { speed, videoDecision: "transcode" },
        })),
      });
      return;
    }

    if (path === "/:/prefs") {
      if (method === "PUT") {
        for (const [id, value] of q) prefs.set(id, value);
        emptyOk();
        return;
      }
      json({ Setting: [...prefs].map(([id, value]) => ({ id, value })) });
      return;
    }

    if (path === "/:/unscrobble") {
      journal.unscrobbled.push(q.get("key") ?? "");
      emptyOk();
      return;
    }

    // Anything else is a gap in the mock, and the test should see it rather
    // than a plausible-looking empty container.
    journal.unhandled.push(`${method} ${path}`);
    json({ Metadata: [], Directory: [], Hub: [] });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        journal,
        items,
        collections,
        shows,
        sectionOrderings,
        prefs,
        history,
        playback,
        failWith(method, failPath, status, opts = {}) {
          if (status == null) forcedFailures.delete(`${method} ${failPath}`);
          else forcedFailures.set(`${method} ${failPath}`, { status, after: opts.after ?? 0 });
        },
        close: () => closeServer(server),
      });
    });
  });
}

function metadataFor(item: MockItem) {
  const streams = (item.audioLanguages ?? []).map((language) => ({
    streamType: 2,
    language,
    languageCode: language.slice(0, 3).toLowerCase(),
  }));
  return {
    ratingKey: item.ratingKey,
    title: item.title,
    year: item.year,
    type: "movie",
    ...(item.thumb ? { thumb: item.thumb } : {}),
    ...(item.duration != null ? { duration: item.duration } : {}),
    ...(item.viewCount != null ? { viewCount: item.viewCount } : {}),
    ...(item.viewOffset != null ? { viewOffset: item.viewOffset } : {}),
    Guid: item.guids.map((id) => ({ id })),
    Label: item.labels.map((tag) => ({ tag })),
    // Always a Media/Part, with both `key` (streamable) and `file` (the
    // server's own path). Anything that plays a part has to pick the right one.
    Media: [
      {
        container: "mkv",
        videoResolution: "1080",
        Part: [
          {
            key: `/library/parts/${item.ratingKey}/1/file.mkv`,
            file: `/data/media/${item.ratingKey}.mkv`,
            container: "mkv",
            Stream: streams,
          },
        ],
      },
    ],
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
