/**
 * A stateful Radarr, over real HTTP.
 *
 * Same reasoning as the mock Plex: the interesting failures in the *Arr client
 * are on the wire, not in the branching. In particular this answers `DELETE`
 * with **200 and an empty body**, which is what some Radarr versions actually
 * do and what used to throw inside `arrFetch` *after* the file was already
 * gone — leaving the item un-actioned and retried forever.
 *
 * It also records the query string verbatim, so a test can assert that
 * `deleteFiles` and the exclusion flags went out as configured rather than
 * trusting that they were assembled correctly.
 */
import { createServer, type Server } from "node:http";

export interface MockMovie {
  id: number;
  title: string;
  tmdbId: number;
  imdbId?: string;
  monitored: boolean;
  hasFile: boolean;
}

export interface ArrJournal {
  /** Full `path?query` of every delete, so flags can be asserted. */
  deletes: string[];
  /** `{ id, monitored }` per monitor toggle. */
  monitorWrites: Array<{ id: number; monitored: boolean }>;
  lookups: string[];
  unhandled: string[];
}

export interface MockArr {
  origin: string;
  journal: ArrJournal;
  movies: Map<number, MockMovie>;
  close: () => Promise<void>;
}

export function startMockRadarr(initial: MockMovie[]): Promise<MockArr> {
  const movies = new Map(initial.map((m) => [m.id, { ...m }]));
  const journal: ArrJournal = { deletes: [], monitorWrites: [], lookups: [], unhandled: [] };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const path = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    const json = (body: unknown) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (path === "/api/v3/system/status") {
      json({ instanceName: "Mock Radarr", version: "5.0.0" });
      return;
    }

    // ── The library ─────────────────────────────────────────────────────────
    if (path === "/api/v3/movie" && method === "GET") {
      journal.lookups.push(`${path}${url.search}`);
      const tmdbId = url.searchParams.get("tmdbId");
      const rows = [...movies.values()].filter((m) => (tmdbId ? String(m.tmdbId) === tmdbId : true));
      json(rows);
      return;
    }

    const byId = path.match(/^\/api\/v3\/movie\/(\d+)$/);
    if (byId) {
      const id = Number(byId[1]);

      if (method === "DELETE") {
        journal.deletes.push(`${path}${url.search}`);
        movies.delete(id);
        // 200 with no body — the shape that used to throw on res.json().
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end();
        return;
      }

      if (method === "PUT") {
        // The client sends the whole record back; only `monitored` matters here.
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          let monitored = false;
          try {
            monitored = JSON.parse(body || "{}").monitored === true;
          } catch {
            // A malformed body is the test's problem to notice, not a crash.
          }
          journal.monitorWrites.push({ id, monitored });
          const movie = movies.get(id);
          if (movie) movie.monitored = monitored;
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
        movies,
        close: () => closeServer(server),
      });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
