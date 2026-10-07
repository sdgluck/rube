/**
 * SABnzbd, NZBGet, qBittorrent, Transmission and Deluge, over real HTTP.
 *
 * Each models the part of its app that is easy to get wrong from a client: the
 * auth handshake. SABnzbd answers a bad key with a 200; NZBGet wants basic
 * auth; qBittorrent wants a login cookie and 403s without it; Transmission
 * 409s the first call to hand out a session id; Deluge wants a login cookie
 * *and* a connected daemon. A `fetch` stub would agree with whatever the
 * client sent.
 *
 * The download model underneath is shared and deliberately small — an id, a
 * name, how far along, whether it is paused — and each mock renders it in its
 * own app's vocabulary. `journal.actions` records what was asked for in that
 * same small vocabulary (`pause`, `resumeItem:<id>`), so one test shape works
 * for all five.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface MockDownload {
  /** nzo_id, NZBID, or info hash — whatever the app calls it. */
  id: string;
  name: string;
  /** 0–1. */
  done: number;
  /** Bytes. */
  size: number;
  paused: boolean;
  /** NZBGet only: the `drone` parameter an *Arr attaches. */
  drone?: string;
  /** Torrents only: a client-side error message. */
  error?: string;
}

export interface MockDownloadClient {
  origin: string;
  /** Mutable by a test, to model a change made in the app's own UI. */
  state: { paused: boolean; items: MockDownload[] };
  journal: { requests: string[]; actions: string[]; logins: number };
  close: () => Promise<void>;
}

interface Harness {
  state: MockDownloadClient["state"];
  journal: MockDownloadClient["journal"];
}

type Handler = (req: IncomingMessage, url: URL, body: string, res: ServerResponse, h: Harness) => void;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string | string[]> = {},
): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function text(
  res: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string | string[]> = {},
): void {
  res.writeHead(status, { "Content-Type": "text/plain", ...headers });
  res.end(body);
}

function start(items: MockDownload[], handler: Handler): Promise<MockDownloadClient> {
  const harness: Harness = {
    state: { paused: false, items: items.map((i) => ({ ...i })) },
    journal: { requests: [], actions: [], logins: 0 },
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    harness.journal.requests.push(`${req.method} ${url.pathname}${url.search}`);
    handler(req, url, await readBody(req), res, harness);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        state: harness.state,
        journal: harness.journal,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function setPaused(h: Harness, ids: string[] | "all", paused: boolean): void {
  for (const item of h.state.items) {
    if (ids === "all" || ids.includes(item.id)) item.paused = paused;
  }
}

function basicOk(req: IncomingMessage, username: string, password: string): boolean {
  const header = req.headers.authorization ?? "";
  return header === `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

// ─── SABnzbd ──────────────────────────────────────────────────────────────────

/**
 * While the queue is paused, an item nobody paused individually still reports
 * "Downloading" — the case `createDownloadClient` has to read as paused.
 */
export function createMockSabnzbd(opts: { apiKey: string; items?: MockDownload[] }): Promise<MockDownloadClient> {
  return start(opts.items ?? [], (_req, url, _body, res, h) => {
    if (!url.pathname.endsWith("/api")) return text(res, 404, "Not found");
    const p = url.searchParams;
    const mode = p.get("mode");
    if (mode === "version") return json(res, 200, { version: "4.3.2" });
    if (p.get("apikey") !== opts.apiKey) return json(res, 200, { status: false, error: "API Key Incorrect" });

    if (mode === "pause" || mode === "resume") {
      h.state.paused = mode === "pause";
      h.journal.actions.push(mode);
      return json(res, 200, { status: true });
    }
    if (mode === "queue" && (p.get("name") === "pause" || p.get("name") === "resume")) {
      const id = p.get("value") ?? "";
      setPaused(h, [id], p.get("name") === "pause");
      h.journal.actions.push(`${p.get("name")}Item:${id}`);
      return json(res, 200, { status: true, nzo_ids: [id] });
    }
    if (mode === "queue") {
      const slots = (p.get("limit") === "0" ? [] : h.state.items).map((i, index) => ({
        nzo_id: i.id,
        filename: i.name,
        status: i.paused ? "Paused" : index === 0 ? "Downloading" : "Queued",
        mb: (i.size / 1024 / 1024).toFixed(2),
        mbleft: ((i.size * (1 - i.done)) / 1024 / 1024).toFixed(2),
        percentage: String(Math.round(i.done * 100)),
      }));
      return json(res, 200, {
        queue: { paused: h.state.paused, kbpersec: h.state.paused ? "0.00" : "2048.00", version: "4.3.2", slots },
      });
    }
    return json(res, 200, { status: false, error: "not implemented" });
  });
}

// ─── NZBGet ───────────────────────────────────────────────────────────────────

export function createMockNzbget(opts: {
  username: string;
  password: string;
  items?: MockDownload[];
}): Promise<MockDownloadClient> {
  return start(opts.items ?? [], (req, url, body, res, h) => {
    if (url.pathname !== "/jsonrpc") return text(res, 404, "Not found");
    if (!basicOk(req, opts.username, opts.password)) return text(res, 401, "Unauthorized");
    const { method, params = [] } = JSON.parse(body) as { method: string; params?: unknown[] };
    const result = (value: unknown) => json(res, 200, { version: "1.1", result: value });

    switch (method) {
      case "version":
        return result("24.3");
      case "status":
        return result({ DownloadPaused: h.state.paused, DownloadRate: h.state.paused ? 0 : 5_000_000 });
      case "listgroups":
        return result(
          h.state.items.map((i, index) => {
            const left = Math.round(i.size * (1 - i.done));
            return {
              NZBID: Number(i.id),
              NZBName: i.name,
              Status: i.paused ? "PAUSED" : index === 0 ? "DOWNLOADING" : "QUEUED",
              FileSizeLo: i.size % 2 ** 32,
              FileSizeHi: Math.floor(i.size / 2 ** 32),
              RemainingSizeLo: left % 2 ** 32,
              RemainingSizeHi: Math.floor(left / 2 ** 32),
              Parameters: i.drone ? [{ Name: "drone", Value: i.drone }] : [],
            };
          }),
        );
      case "pausedownload":
      case "resumedownload":
        h.state.paused = method === "pausedownload";
        h.journal.actions.push(method === "pausedownload" ? "pause" : "resume");
        return result(true);
      case "editqueue": {
        const [command, , ids] = params as [string, string, number[]];
        // The pre-v16 four-argument form puts a number second; refuse it so a
        // client using it fails here as it would against a current NZBGet.
        if (params.length !== 3 || !Array.isArray(ids)) return result(false);
        const action = command === "GroupPause" ? "pause" : command === "GroupResume" ? "resume" : null;
        if (!action) return result(false);
        setPaused(h, ids.map(String), action === "pause");
        for (const id of ids) h.journal.actions.push(`${action}Item:${id}`);
        return result(true);
      }
      default:
        return json(res, 200, {
          version: "1.1",
          error: { name: "JsonRpcError", code: 1, message: "Method not found" },
        });
    }
  });
}

// ─── qBittorrent ──────────────────────────────────────────────────────────────

const QBIT_SID = "SID=mock-session";

export function createMockQbittorrent(opts: {
  username: string;
  password: string;
  items?: MockDownload[];
  /** `2.11.x` and up is qBittorrent 5: stop/start rather than pause/resume. */
  webApiVersion?: string;
}): Promise<MockDownloadClient> {
  const webApi = opts.webApiVersion ?? "2.11.2";
  const modern = Number(webApi.split(".")[1]) >= 11 || Number(webApi.split(".")[0]) > 2;
  return start(opts.items ?? [], (req, url, body, res, h) => {
    if (url.pathname === "/api/v2/auth/login") {
      const form = new URLSearchParams(body);
      h.journal.logins++;
      if (form.get("username") === opts.username && form.get("password") === opts.password) {
        return text(res, 200, "Ok.", { "Set-Cookie": `${QBIT_SID}; HttpOnly; path=/` });
      }
      return text(res, 200, "Fails.");
    }
    if (!(req.headers.cookie ?? "").includes(QBIT_SID)) return text(res, 403, "Forbidden");

    const verb = url.pathname.match(/^\/api\/v2\/torrents\/(pause|resume|stop|start)$/)?.[1];
    if (verb) {
      if ((verb === "stop" || verb === "start") !== modern) return text(res, 404, "Not Found");
      const hashes = new URLSearchParams(body).get("hashes") ?? "";
      const pause = verb === "pause" || verb === "stop";
      setPaused(h, hashes === "all" ? "all" : hashes.split("|"), pause);
      h.journal.actions.push(
        hashes === "all" ? (pause ? "pause" : "resume") : `${pause ? "pause" : "resume"}Item:${hashes}`,
      );
      return text(res, 200, "");
    }

    switch (url.pathname) {
      case "/api/v2/app/version":
        return text(res, 200, "v5.0.3");
      case "/api/v2/app/webapiVersion":
        return text(res, 200, webApi);
      case "/api/v2/torrents/info":
        return json(
          res,
          200,
          h.state.items.map((i) => ({
            hash: i.id,
            name: i.name,
            state: i.error
              ? "error"
              : i.done >= 1
                ? i.paused
                  ? modern
                    ? "stoppedUP"
                    : "pausedUP"
                  : "uploading"
                : i.paused
                  ? modern
                    ? "stoppedDL"
                    : "pausedDL"
                  : "downloading",
            progress: i.done,
            size: i.size,
            amount_left: Math.round(i.size * (1 - i.done)),
            dlspeed: i.paused || i.done >= 1 ? 0 : 1_000_000,
          })),
        );
      default:
        return text(res, 404, "Not Found");
    }
  });
}

// ─── Transmission ─────────────────────────────────────────────────────────────

const TRANSMISSION_SESSION = "mock-session-id";

export function createMockTransmission(opts: {
  username?: string;
  password?: string;
  items?: MockDownload[];
}): Promise<MockDownloadClient> {
  return start(opts.items ?? [], (req, url, body, res, h) => {
    if (url.pathname !== "/transmission/rpc") return text(res, 404, "Not found");
    if ((opts.username || opts.password) && !basicOk(req, opts.username ?? "", opts.password ?? "")) {
      return text(res, 401, "Unauthorized");
    }
    if (req.headers["x-transmission-session-id"] !== TRANSMISSION_SESSION) {
      return text(res, 409, "Conflict", { "X-Transmission-Session-Id": TRANSMISSION_SESSION });
    }
    const { method, arguments: args = {} } = JSON.parse(body) as {
      method: string;
      arguments?: { ids?: string[] };
    };
    const ok = (value: unknown = {}) => json(res, 200, { result: "success", arguments: value });

    switch (method) {
      case "session-get":
        return ok({ version: "4.0.6 (38c164933e)" });
      case "torrent-get":
        return ok({
          torrents: h.state.items.map((i) => ({
            hashString: i.id,
            name: i.name,
            status: i.paused ? 0 : i.done >= 1 ? 6 : 4,
            percentDone: i.done,
            sizeWhenDone: i.size,
            leftUntilDone: Math.round(i.size * (1 - i.done)),
            rateDownload: i.paused || i.done >= 1 ? 0 : 500_000,
            error: i.error ? 3 : 0,
            errorString: i.error ?? "",
          })),
        });
      case "torrent-stop":
      case "torrent-start": {
        const pause = method === "torrent-stop";
        setPaused(h, args.ids ?? "all", pause);
        if (args.ids) for (const id of args.ids) h.journal.actions.push(`${pause ? "pause" : "resume"}Item:${id}`);
        else h.journal.actions.push(pause ? "pause" : "resume");
        return ok();
      }
      default:
        return json(res, 200, { result: `method name not recognized` });
    }
  });
}

// ─── Deluge ───────────────────────────────────────────────────────────────────

const DELUGE_COOKIE = "_session_id=mock-deluge";

export function createMockDeluge(opts: {
  password: string;
  items?: MockDownload[];
  /** Deluge 1.3: no `pause_torrents`/`resume_torrents`, only the list-taking singular. */
  legacy?: boolean;
}): Promise<MockDownloadClient> {
  let connected = false;
  return start(opts.items ?? [], (req, url, body, res, h) => {
    if (url.pathname !== "/json") return text(res, 404, "Not found");
    const { method, params = [], id } = JSON.parse(body) as { method: string; params?: unknown[]; id: number };
    const result = (value: unknown, headers: Record<string, string> = {}) =>
      json(res, 200, { result: value, error: null, id }, headers);
    const error = (code: number, message: string) => json(res, 200, { result: null, error: { code, message }, id });

    if (method === "auth.login") {
      h.journal.logins++;
      if (params[0] === opts.password) return result(true, { "Set-Cookie": `${DELUGE_COOKIE}; Path=/json` });
      return result(false);
    }
    if (!(req.headers.cookie ?? "").includes(DELUGE_COOKIE)) return error(1, "Not authenticated");

    switch (method) {
      case "web.connected":
        return result(connected);
      case "web.get_hosts":
        return result([["host-1", "127.0.0.1", 58846, "localclient"]]);
      case "web.connect":
        connected = params[0] === "host-1";
        return result(null);
    }
    if (!connected) return error(2, "Not connected to a daemon");

    const torrentAction = method.match(/^core\.(pause|resume)_torrents?$/);
    if (torrentAction) {
      const plural = method.endsWith("s");
      if (plural && opts.legacy) return error(2, `Unknown method: ${method}`);
      const ids = params[0] as string[];
      setPaused(h, ids, torrentAction[1] === "pause");
      for (const tid of ids) h.journal.actions.push(`${torrentAction[1]}Item:${tid}`);
      return result(null);
    }

    switch (method) {
      case "daemon.info":
        return result("2.1.1");
      case "core.is_session_paused":
        return result(h.state.paused);
      case "core.pause_session":
      case "core.resume_session":
        h.state.paused = method === "core.pause_session";
        h.journal.actions.push(h.state.paused ? "pause" : "resume");
        return result(null);
      case "web.update_ui":
        return result({
          connected: true,
          stats: { download_rate: h.state.paused ? 0 : 750_000 },
          torrents: Object.fromEntries(
            h.state.items.map((i) => [
              i.id,
              {
                name: i.name,
                // A paused *session* leaves torrents reporting "Downloading".
                state: i.error ? "Error" : i.paused ? "Paused" : i.done >= 1 ? "Seeding" : "Downloading",
                progress: i.done * 100,
                total_wanted: i.size,
                total_done: Math.round(i.size * i.done),
                download_payload_rate: i.paused || h.state.paused ? 0 : 750_000,
                message: i.error ?? "OK",
              },
            ]),
          ),
        });
      default:
        return error(2, `Unknown method: ${method}`);
    }
  });
}
