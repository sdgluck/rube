/**
 * A stateful Overseerr over real HTTP: `/api/v1/request`, paged with
 * `take`/`skip`, filtered by `filter`, behind `X-Api-Key`.
 *
 * Requests are served newest first, which is Overseerr's default order. The
 * `available` filter admits partially available media too, as Overseerr's
 * does. Every request path and query lands in `journal`.
 */
import { createServer, type Server } from "node:http";

export interface MockSeerrRequest {
  id: number;
  media: {
    tmdbId: number;
    mediaType: "movie" | "tv";
    /** 1 unknown, 2 pending, 3 processing, 4 partially available, 5 available. */
    status: number;
    ratingKey?: string | null;
    mediaAddedAt?: string | null;
  };
  requestedBy: {
    username?: string | null;
    plexId?: number | null;
    plexUsername?: string | null;
    email?: string | null;
  };
  createdAt: string;
}

export interface MockSeerr {
  origin: string;
  apiKey: string;
  /** Newest first. Mutable by a test. */
  requests: MockSeerrRequest[];
  journal: string[];
  close(): Promise<void>;
}

export async function startMockSeerr(
  seed: { requests?: MockSeerrRequest[]; apiKey?: string } = {},
): Promise<MockSeerr> {
  const apiKey = seed.apiKey ?? "seerr-key";
  const state = { requests: seed.requests ?? [] };
  const journal: string[] = [];

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    journal.push(`${url.pathname}${url.search}`);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers["x-api-key"] !== apiKey) return send(401, { message: "Unauthorized" });

    if (url.pathname === "/api/v1/request") {
      const take = Number(url.searchParams.get("take") ?? 10);
      const skip = Number(url.searchParams.get("skip") ?? 0);
      const filter = url.searchParams.get("filter") ?? "all";
      const matching = state.requests.filter((r) =>
        filter === "available" ? r.media.status === 4 || r.media.status === 5 : true,
      );
      return send(200, {
        pageInfo: {
          pages: Math.ceil(matching.length / take),
          pageSize: take,
          results: matching.length,
          page: skip / take + 1,
        },
        results: matching.slice(skip, skip + take),
      });
    }
    send(404, { message: "Not found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    apiKey,
    get requests() {
      return state.requests;
    },
    set requests(next) {
      state.requests = next;
    },
    journal,
    close: () => new Promise((done) => server.close(() => done())),
  };
}
