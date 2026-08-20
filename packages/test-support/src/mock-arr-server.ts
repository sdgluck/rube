/**
 * A stateful Radarr or Sonarr, over real HTTP.
 *
 * Same reasoning as the mock Plex: the interesting failures in the *Arr client
 * are on the wire, not in the branching. In particular this answers `DELETE`
 * with **200 and an empty body**, which is what some Radarr versions actually
 * do and what used to throw inside `arrFetch` *after* the file was already
 * gone — leaving the item un-actioned and retried forever.
 *
 * It records the query string verbatim, so a test can assert that
 * `deleteFiles` and the exclusion flags went out as configured rather than
 * trusting that they were assembled correctly.
 *
 * Moved here from `packages/jobs/src/test-support` once `clients/arr` needed it
 * too. It grew three things in the move:
 *
 * - **Sonarr.** Half of `clients/arr` branches on the service, and the Sonarr
 *   half — `/api/v3/series`, `statistics.episodeFileCount` standing in for
 *   `hasFile` — had no way to be exercised at all.
 * - **Fault injection** (`failNext`, `failWith`). The client's most important
 *   property is that it does *not* retry a mutation, and you cannot assert a
 *   negative without a first attempt that fails.
 * - **A full record journal** for PUTs rather than just `{ id, monitored }`, so
 *   a test can assert that a monitor toggle preserved the rest of the row.
 *   Both *Arrs replace the row wholesale, so a PUT that drops a field nulls it.
 */
import { createServer, type Server } from "node:http";

export interface MockMovie {
  id: number;
  title: string;
  tmdbId: number;
  imdbId?: string;
  monitored: boolean;
  hasFile: boolean;
  /** Anything else the real row carries. Echoed back, so a PUT can drop it. */
  [extra: string]: unknown;
}

export interface MockSeries {
  id: number;
  title: string;
  tvdbId: number;
  imdbId?: string;
  tmdbId?: number;
  monitored: boolean;
  statistics?: { episodeFileCount?: number };
  [extra: string]: unknown;
}

export type MockArrRecord = MockMovie | MockSeries;

export interface ArrJournal {
  /** Full `path?query` of every delete, so flags can be asserted. */
  deletes: string[];
  /** `{ id, monitored }` per monitor toggle. */
  monitorWrites: Array<{ id: number; monitored: boolean }>;
  /** The complete body of every PUT, to catch a write that dropped a field. */
  puts: Array<{ id: number; body: Record<string, unknown> }>;
  /** Every POST to the add endpoint. */
  adds: Array<Record<string, unknown>>;
  lookups: string[];
  unhandled: string[];
  /** Every request, in order, as `METHOD path`. */
  requests: string[];
}

export interface MockArr {
  origin: string;
  journal: ArrJournal;
  /** Live library state, keyed by *Arr id. */
  records: Map<number, MockArrRecord>;
  /**
   * The same Map under its Radarr name.
   *
   * `records` is the honest name now that this serves Sonarr too, but the
   * existing Radarr tests read `movies` and there is no sense in a rename that
   * only makes a diff.
   */
  movies: Map<number, MockArrRecord>;
  /**
   * Fail the next `n` requests with `status` before behaving normally again.
   *
   * The point is asserting that a mutation is *not* retried: without a way to
   * make the first attempt fail, "exactly one DELETE reached the server" is
   * indistinguishable from "the retry happened to succeed first time".
   */
  failNext: (n: number, status?: number, body?: string) => void;
  /** Answer every request to `path` with this status until cleared. */
  failWith: (path: string, status: number, body?: string) => void;
  close: () => Promise<void>;
}

interface Options {
  service: "radarr" | "sonarr";
  initial: MockArrRecord[];
  /** What a lookup-by-term returns. Defaults to nothing found. */
  lookupResults?: Array<Record<string, unknown>>;
}

function startMockArr(opts: Options): Promise<MockArr> {
  const { service } = opts;
  const collection = service === "radarr" ? "movie" : "series";
  const records = new Map(opts.initial.map((r) => [r.id, { ...r }]));
  const journal: ArrJournal = {
    deletes: [],
    monitorWrites: [],
    puts: [],
    adds: [],
    lookups: [],
    unhandled: [],
    requests: [],
  };

  let failuresRemaining = 0;
  let failureStatus = 500;
  let failureBody = "";
  const pathFailures = new Map<string, { status: number; body: string }>();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const path = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();
    journal.requests.push(`${method} ${path}`);

    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    const forced = pathFailures.get(path);
    if (forced) {
      res.writeHead(forced.status, { "Content-Type": "application/json" });
      res.end(forced.body);
      return;
    }

    if (failuresRemaining > 0) {
      failuresRemaining--;
      res.writeHead(failureStatus, { "Content-Type": "application/json" });
      res.end(failureBody);
      return;
    }

    if (path === "/api/v3/system/status") {
      json({ instanceName: service === "radarr" ? "Mock Radarr" : "Mock Sonarr", version: "5.0.0" });
      return;
    }

    if (path === "/api/v3/qualityprofile") {
      json([
        { id: 1, name: "HD-1080p", extra: "ignored" },
        { id: 2, name: "Ultra-HD" },
      ]);
      return;
    }

    if (path === "/api/v3/rootfolder") {
      json([{ id: 1, path: "/data/media", freeSpace: 1_000, accessible: true }]);
      return;
    }

    if (path === `/api/v3/${collection}/lookup`) {
      journal.lookups.push(`${path}${url.search}`);
      json(opts.lookupResults ?? []);
      return;
    }

    // ── The library ─────────────────────────────────────────────────────────
    if (path === `/api/v3/${collection}` && method === "GET") {
      journal.lookups.push(`${path}${url.search}`);
      const tmdbId = url.searchParams.get("tmdbId");
      const rows = [...records.values()].filter((r) => (tmdbId ? String(r.tmdbId) === tmdbId : true));
      json(rows);
      return;
    }

    if (path === `/api/v3/${collection}` && method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(body || "{}") as Record<string, unknown>;
        } catch {
          // Left empty on purpose — the test asserts on the journal.
        }
        journal.adds.push(parsed);

        const externalId = service === "radarr" ? parsed.tmdbId : parsed.tvdbId;
        const clash = [...records.values()].some((r) => (service === "radarr" ? r.tmdbId : r.tvdbId) === externalId);
        if (clash) {
          // The real 400 body, near enough: the client matches on the prose.
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify([{ errorMessage: "This movie has already been added" }]));
          return;
        }

        const id = Math.max(0, ...records.keys()) + 1;
        records.set(id, { ...(parsed as MockArrRecord), id });
        json({ id, title: parsed.title });
      });
      return;
    }

    const byId = new RegExp(`^/api/v3/${collection}/(\\d+)$`).exec(path);
    if (byId) {
      const id = Number(byId[1]);

      /**
       * Single-record read.
       *
       * Added when the add path started writing its result through to the
       * mirror: without it a `GET /movie/7` fell to the unhandled branch and
       * answered `[]`, which parses into a record with no id at all and
       * corrupts whatever stores it. A mock that answers the wrong shape is
       * worse than one that 404s.
       */
      if (method === "GET") {
        const record = records.get(id);
        if (!record) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end("{}");
          return;
        }
        json(record);
        return;
      }

      if (method === "DELETE") {
        journal.deletes.push(`${path}${url.search}`);
        records.delete(id);
        // 200 with no body — the shape that used to throw on res.json().
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end();
        return;
      }

      if (method === "PUT") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(body || "{}") as Record<string, unknown>;
          } catch {
            // A malformed body is the test's problem to notice, not a crash.
          }
          journal.puts.push({ id, body: parsed });
          journal.monitorWrites.push({ id, monitored: parsed.monitored === true });
          // Wholesale replacement, exactly as the real thing does — so a client
          // that PUTs a partial body loses whatever it left out.
          records.set(id, { ...(parsed as MockArrRecord), id });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end();
        });
        return;
      }
    }

    journal.unhandled.push(`${method} ${path}`);
    json([]);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        journal,
        records,
        movies: records,
        failNext(n, status = 500, body = "") {
          failuresRemaining = n;
          failureStatus = status;
          failureBody = body;
        },
        failWith(path, status, body = "") {
          pathFailures.set(path, { status, body });
        },
        close: () => closeServer(server),
      });
    });
  });
}

export function startMockRadarr(
  initial: MockMovie[],
  extra?: { lookupResults?: Array<Record<string, unknown>> },
): Promise<MockArr> {
  return startMockArr({ service: "radarr", initial, lookupResults: extra?.lookupResults });
}

export function startMockSonarr(
  initial: MockSeries[],
  extra?: { lookupResults?: Array<Record<string, unknown>> },
): Promise<MockArr> {
  return startMockArr({ service: "sonarr", initial, lookupResults: extra?.lookupResults });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
