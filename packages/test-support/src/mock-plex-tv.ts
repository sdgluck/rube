/**
 * plex.tv's PIN sign-in, over real HTTP.
 *
 * The native app signs in by running the PIN flow itself and handing the
 * resulting token to each server's `auth.exchange`, so both halves — the app's
 * polling and the server's `/user` lookup — are worth exercising against
 * something that answers like plex.tv rather than a stub that agrees with the
 * caller about URLs and headers.
 *
 * Point a server at it with `TINKERBELL_PLEX_TV_URL` (honoured outside
 * production only, see `clients/plex/src/auth.ts`). `/auth?code=…` stands in
 * for app.plex.tv: opening it approves the PIN as `defaultAccount`, which is
 * what lets a simulator complete sign-in with nobody tapping through plex.tv.
 *
 * A model, not the real service: it records the shapes Tinkerbell reads and
 * nothing else.
 */
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";

export interface MockPlexTvAccount {
  id: number;
  uuid?: string;
  username: string;
  email?: string;
}

export interface MockPlexTvServer {
  origin: string;
  /** `METHOD path` for every request, plus the client id it was sent with. */
  journal: { requests: string[]; clientIds: string[] };
  /** Mark a PIN approved by `account`, as tapping "Allow" on plex.tv would. */
  approve: (pinId: number, account?: MockPlexTvAccount) => string;
  /** Mint a token for `account` directly, skipping the PIN. */
  tokenFor: (account: MockPlexTvAccount) => string;
  /** Fail the next `n` requests with `status`. */
  failNext: (n: number, status?: number) => void;
  close: () => Promise<void>;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

export async function startMockPlexTv(
  opts: { defaultAccount?: MockPlexTvAccount; port?: number; host?: string } = {},
): Promise<MockPlexTvServer> {
  const defaultAccount = opts.defaultAccount ?? { id: 42, username: "owner" };
  const pins = new Map<number, { code: string; clientId: string; authToken: string | null }>();
  const tokens = new Map<string, MockPlexTvAccount>();
  const journal = { requests: [] as string[], clientIds: [] as string[] };
  let nextPin = 1000;
  let failuresRemaining = 0;
  let failureStatus = 500;

  function tokenFor(account: MockPlexTvAccount): string {
    const token = `plextv-${randomBytes(12).toString("hex")}`;
    tokens.set(token, account);
    return token;
  }

  function approve(pinId: number, account: MockPlexTvAccount = defaultAccount): string {
    const pin = pins.get(pinId);
    if (!pin) throw new Error(`no such PIN ${pinId}`);
    pin.authToken = tokenFor(account);
    return pin.authToken;
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const method = (req.method ?? "GET").toUpperCase();
    const clientId = String(req.headers["x-plex-client-identifier"] ?? "");
    journal.requests.push(`${method} ${url.pathname}`);
    journal.clientIds.push(clientId);

    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (failuresRemaining > 0) {
      failuresRemaining--;
      json({ errors: [{ message: "mock failure" }] }, failureStatus);
      return;
    }

    if (method === "POST" && url.pathname === "/api/v2/pins") {
      const id = nextPin++;
      const code = randomBytes(4).toString("hex");
      pins.set(id, { code, clientId, authToken: null });
      json({ id, code }, 201);
      return;
    }

    const pinMatch = /^\/api\/v2\/pins\/(\d+)$/.exec(url.pathname);
    if (method === "GET" && pinMatch) {
      const pin = pins.get(Number(pinMatch[1]));
      // plex.tv only redeems a PIN for the client id that created it.
      if (!pin || pin.clientId !== clientId) return json({ errors: [{ message: "Not found" }] }, 404);
      json({ id: Number(pinMatch[1]), code: pin.code, authToken: pin.authToken });
      return;
    }

    if (method === "GET" && url.pathname === "/api/v2/user") {
      const account = tokens.get(String(req.headers["x-plex-token"] ?? ""));
      if (!account) return json({ errors: [{ message: "Invalid token" }] }, 401);
      json({ uuid: `uuid-${account.id}`, email: `${account.username}@example.test`, ...account });
      return;
    }

    // The app.plex.tv stand-in: approve by code, then show a page the in-app
    // browser sheet can sit on until the app's poll closes it.
    if (method === "GET" && url.pathname === "/auth") {
      const code = url.searchParams.get("code");
      const entry = [...pins.entries()].find(([, p]) => p.code === code);
      if (entry) approve(entry[0]);
      res.writeHead(entry ? 200 : 404, { "Content-Type": "text/html" });
      res.end(entry ? "<p>Approved by the mock plex.tv.</p>" : "<p>Unknown code.</p>");
      return;
    }

    json({ errors: [{ message: "unhandled" }] }, 404);
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    origin: `http://${opts.host && opts.host !== "0.0.0.0" ? opts.host : "127.0.0.1"}:${port}`,
    journal,
    approve,
    tokenFor,
    failNext: (n, status = 500) => {
      failuresRemaining = n;
      failureStatus = status;
    },
    close: () => closeServer(server),
  };
}
