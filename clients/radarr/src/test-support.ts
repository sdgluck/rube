/**
 * A mock Radarr, on a real socket.
 *
 * A local `node:http` server rather than a stubbed `fetch`, matching
 * `clients/plex`. The behaviours worth pinning here — the whole-library GET,
 * the 400-already-exists branch, and above all the read-before-write that
 * `updateMovie` performs — are all about what goes over the wire, and a stub
 * would only assert our own idea of what fetch does.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";

export interface RecordedRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  body: unknown;
}

export type Route = (req: RecordedRequest) => { status?: number; body?: unknown };

export function createMockArr() {
  const requests: RecordedRequest[] = [];
  const routes = new Map<string, Route>();
  let server: Server;

  function handler(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url!, "http://localhost");
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const params: Record<string, string> = {};
      for (const [k, v] of url.searchParams) params[k] = v;
      const recorded: RecordedRequest = {
        method: req.method!,
        path: url.pathname,
        params,
        body: raw ? JSON.parse(raw) : undefined,
      };
      requests.push(recorded);

      const route = routes.get(`${req.method} ${url.pathname}`);
      if (!route) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end("[]");
        return;
      }
      const out = route(recorded);
      res.writeHead(out.status ?? 200, { "Content-Type": "application/json" });
      res.end(out.body === undefined ? "" : JSON.stringify(out.body));
    });
  }

  return {
    requests,
    /** `on("GET /api/v3/movie", …)` — the full path, version prefix included. */
    on(key: string, route: Route) {
      routes.set(key, route);
      return this;
    },
    /** Requests to one path, in order. The read-before-write assertions use this. */
    to(path: string): RecordedRequest[] {
      return requests.filter((r) => r.path === path);
    },
    start(): Promise<string> {
      server = createServer(handler);
      return new Promise((resolve) => {
        server.listen(0, () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`));
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
