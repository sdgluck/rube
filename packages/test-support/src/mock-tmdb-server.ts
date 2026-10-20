/**
 * A stateful TMDb over real HTTP, for jobs that read film details and
 * collections (franchises).
 *
 * Small on purpose: `/movie/:id` and `/collection/:id`, the two endpoints a
 * franchise walk needs, shaped like TMDb's v3 responses. Point the client at
 * `origin` through `TmdbConfig.baseUrl`. Every request lands in `journal`, so a
 * test can tell a cache hit from a refetch.
 */
import { createServer, type Server } from "node:http";

export interface MockTmdbMovie {
  id: number;
  title: string;
  releaseDate?: string;
  /** The franchise, by collection id. */
  collectionId?: number;
  keywords?: number[];
}

export interface MockTmdbCollection {
  id: number;
  name: string;
  /** Part ids, in any order; titles and dates come from `movies`. */
  partIds: number[];
}

export interface MockTmdb {
  origin: string;
  movies: Map<number, MockTmdbMovie>;
  collections: Map<number, MockTmdbCollection>;
  /** Every request path, in order. */
  journal: string[];
  close(): Promise<void>;
}

export async function startMockTmdb(
  seed: { movies?: MockTmdbMovie[]; collections?: MockTmdbCollection[] } = {},
): Promise<MockTmdb> {
  const movies = new Map((seed.movies ?? []).map((m) => [m.id, m]));
  const collections = new Map((seed.collections ?? []).map((c) => [c.id, c]));
  const journal: string[] = [];

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    journal.push(url.pathname);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const notFound = () =>
      send(404, { status_code: 34, status_message: "The resource you requested could not be found." });

    const movie = url.pathname.match(/^\/movie\/(\d+)$/);
    if (movie) {
      const m = movies.get(Number(movie[1]));
      if (!m) return notFound();
      const collection = m.collectionId != null ? collections.get(m.collectionId) : undefined;
      return send(200, {
        id: m.id,
        title: m.title,
        release_date: m.releaseDate ?? "",
        genres: [],
        production_companies: [],
        production_countries: [],
        keywords: { keywords: (m.keywords ?? []).map((id) => ({ id, name: `keyword ${id}` })) },
        belongs_to_collection: collection ? { id: collection.id, name: collection.name } : null,
      });
    }

    const coll = url.pathname.match(/^\/collection\/(\d+)$/);
    if (coll) {
      const c = collections.get(Number(coll[1]));
      if (!c) return notFound();
      return send(200, {
        id: c.id,
        name: c.name,
        overview: "",
        parts: c.partIds.map((id) => {
          const m = movies.get(id);
          return { id, title: m?.title ?? `Movie ${id}`, release_date: m?.releaseDate ?? "" };
        }),
      });
    }

    notFound();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    movies,
    collections,
    journal,
    close: () => new Promise((done) => server.close(() => done())),
  };
}
