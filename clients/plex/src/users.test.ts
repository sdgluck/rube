import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createPlexClient, PlexApiError } from "./index.ts";

interface Recorded {
  method: string;
  path: string;
  params: Record<string, string>;
  body: string;
}

/**
 * Stands in for plex.tv. Half of the account API answers XML regardless of
 * what we ask for, so the fixtures below are the real shapes — that asymmetry
 * is the thing most likely to break, and mocking it away would prove nothing.
 */
function createMockPlexTv(routes: Record<string, { status?: number; body: string; contentType?: string }>) {
  const requests: Recorded[] = [];

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url!, "http://localhost");
    const params: Record<string, string> = {};
    for (const [k, v] of url.searchParams) {
      if (k === "X-Plex-Token") continue;
      params[k] = v;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method!, path: url.pathname, params, body });
      const route = routes[`${req.method} ${url.pathname}`] ?? routes[url.pathname];
      if (!route) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(route.status ?? 200, { "Content-Type": route.contentType ?? "application/json" });
      res.end(route.body);
    });
  });

  return {
    requests,
    start(): Promise<number> {
      return new Promise((resolve) => {
        server.listen(0, () => resolve((server.address() as { port: number }).port));
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

const SHARED_SERVERS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer size="2">
  <SharedServer id="880" username="sam" email="sam@example.com" userID="42" accepted="1"
                allowSync="1" allowTuners="0" allowChannels="0" allowCameraUpload="1"
                filterMovies="contentRating=PG|label=Tinkerbell,User:sam" filterTelevision="" filterMusic="">
    <Section id="1" key="1" title="Movies" type="movie" shared="1"/>
    <Section id="2" key="2" title="TV" type="show" shared="0"/>
    <Section id="3" key="3" title="Music" type="artist" shared="1"/>
  </SharedServer>
  <SharedServer id="881" username="kim" email="kim@example.com" userID="43" accepted="0"
                allowSync="0" allowTuners="1" allowChannels="0" allowCameraUpload="0"
                filterMovies="" filterTelevision="" filterMusic="">
    <Section id="1" key="1" title="Movies" type="movie" shared="1"/>
  </SharedServer>
</MediaContainer>`;

const USERS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer size="1">
  <User id="42" title="Sam" username="sam" email="sam@example.com" thumb="https://plex.tv/a.png"
        home="0" restricted="0" protected="0">
    <Server id="880" machineIdentifier="abc" name="Home"/>
  </User>
</MediaContainer>`;

describe("plex.tv user management", () => {
  let plexTv: ReturnType<typeof createMockPlexTv>;
  let client: ReturnType<typeof createPlexClient>;
  let port: number;

  const routes: Record<string, { status?: number; body: string; contentType?: string }> = {
    "GET /api/servers/abc/shared_servers": { body: SHARED_SERVERS_XML, contentType: "application/xml" },
    "GET /api/users/": { body: USERS_XML, contentType: "application/xml" },
    "GET /api/v2/home/users": {
      body: JSON.stringify({
        users: [
          { id: 1, title: "Owner", username: "owner", admin: true },
          { id: 44, title: "Kid", username: "", restricted: true, protected: true, home: true },
        ],
      }),
    },
    "POST /api/servers/abc/shared_servers": { body: "{}" },
    "PUT /api/servers/abc/shared_servers/880": { body: "{}" },
    "DELETE /api/servers/abc/shared_servers/880": { status: 204, body: "" },
    "PUT /api/friends/42": { body: "{}" },
    "PUT /api/v2/home/users/restricted/44": { body: "{}" },
  };

  beforeEach(async () => {
    plexTv = createMockPlexTv(routes);
    port = await plexTv.start();
    client = createPlexClient({ url: `http://localhost:${port}`, token: "t", plexTvUrl: `http://localhost:${port}` });
  });

  afterEach(async () => {
    await plexTv.stop();
  });

  it("reads shares from XML, keeping only shared sections", async () => {
    const shares = await client.getSharedServersFull("abc");
    assert.equal(shares.length, 2);

    const sam = shares.find((s) => s.userId === 42)!;
    // The share id, not the user id — the section and unshare endpoints key on it.
    assert.equal(sam.sharedServerId, 880);
    assert.deepEqual(sam.librarySectionIds, [1, 3]);
    assert.equal(sam.allowSync, true);
    assert.equal(sam.allowTuners, false);
    assert.equal(sam.allowCameraUpload, true);
    assert.equal(sam.filterMovies, "contentRating=PG|label=Tinkerbell,User:sam");
    assert.equal(sam.accepted, true);

    // An outstanding invite is a share that exists but hasn't been taken up.
    assert.equal(shares.find((s) => s.userId === 43)!.accepted, false);
  });

  it("reads friends from XML", async () => {
    const friends = await client.listFriends();
    assert.equal(friends.length, 1);
    assert.equal(friends[0].id, 42);
    assert.equal(friends[0].username, "sam");
    assert.equal(friends[0].email, "sam@example.com");
    assert.equal(friends[0].home, false);
  });

  it("reads home users, dropping the owner, and falls back to the title for a nameless profile", async () => {
    const home = await client.listHomeUsers();
    assert.equal(home.length, 1);
    assert.equal(home[0].id, 44);
    assert.equal(home[0].username, "Kid");
    assert.equal(home[0].restricted, true);
    assert.equal(home[0].protected, true);
  });

  it("posts an invite as the snake_cased body plex.tv expects", async () => {
    await client.inviteUser({
      machineIdentifier: "abc",
      invitedEmail: "new@example.com",
      librarySectionIds: [1, 2],
      settings: { allowSync: true, allowTuners: false },
    });

    const req = plexTv.requests.find((r) => r.method === "POST")!;
    const body = JSON.parse(req.body);
    assert.equal(body.server_id, "abc");
    assert.equal(body.shared_server.invited_email, "new@example.com");
    assert.deepEqual(body.shared_server.library_section_ids, [1, 2]);
    // Booleans go over the wire as 1/0.
    assert.equal(body.sharing_settings.allowSync, 1);
    assert.equal(body.sharing_settings.allowTuners, 0);
  });

  it("surfaces 422 as a status rather than a flattened message", async () => {
    plexTv.requests.length = 0;
    routes["POST /api/servers/abc/shared_servers"] = { status: 422, body: '{"error":"already shared"}' };

    await assert.rejects(
      () => client.inviteUser({ machineIdentifier: "abc", invitedEmail: "dup@example.com", librarySectionIds: [] }),
      (err: unknown) => err instanceof PlexApiError && err.status === 422,
    );

    routes["POST /api/servers/abc/shared_servers"] = { body: "{}" };
  });

  it("sends share settings as 1/0 query params and omits what wasn't asked for", async () => {
    await client.updateShareSettings(42, { allowSync: false, filterMovies: "contentRating=PG" });

    const req = plexTv.requests.find((r) => r.method === "PUT" && r.path === "/api/friends/42")!;
    assert.equal(req.params.allowSync, "0");
    assert.equal(req.params.filterMovies, "contentRating=PG");
    assert.equal(req.params.allowTuners, undefined);
    assert.equal(req.params.filterTelevision, undefined);
  });

  it("preserves a content-rating clause when rewriting personalization labels", async () => {
    await client.setSharingRestrictions(42, ["Tinkerbell", "User:sam"], {
      filterMovies: "contentRating=PG|label=stale",
      filterTelevision: "",
    });

    const req = plexTv.requests.find((r) => r.method === "PUT" && r.path === "/api/friends/42")!;
    assert.equal(req.params.filterMovies, "contentRating=PG|label=Tinkerbell,User:sam");
    assert.equal(req.params.filterTelevision, "label=Tinkerbell,User:sam");
  });

  it("addresses the section update by share id, not user id", async () => {
    await client.updateSharedSections("abc", 880, [1, 3]);
    const req = plexTv.requests.find((r) => r.method === "PUT" && r.path.includes("shared_servers"))!;
    assert.deepEqual(JSON.parse(req.body).shared_server.library_section_ids, [1, 3]);
  });

  it("unshares by share id", async () => {
    await client.unshareServer("abc", 880);
    assert.ok(plexTv.requests.some((r) => r.method === "DELETE" && r.path === "/api/servers/abc/shared_servers/880"));
  });

  it("returns no invites rather than failing when the endpoints aren't there", async () => {
    assert.deepEqual(await client.listPendingInvites(), []);
  });
});

describe("session termination", () => {
  let mock: ReturnType<typeof createMockPlexTv>;
  let client: ReturnType<typeof createPlexClient>;

  beforeEach(async () => {
    mock = createMockPlexTv({ "GET /status/sessions/terminate": { status: 200, body: "" } });
    const port = await mock.start();
    client = createPlexClient({ url: `http://localhost:${port}`, token: "t" });
  });

  afterEach(async () => {
    await mock.stop();
  });

  // Plex answers 400 for a lowercase `sessionid`, so the casing is load-bearing.
  it("sends sessionId with a capital I, and the reason", async () => {
    await client.terminateSession("sess-1", "Stop that");
    const req = mock.requests[0];
    assert.equal(req.path, "/status/sessions/terminate");
    assert.equal(req.params.sessionId, "sess-1");
    assert.equal(req.params.reason, "Stop that");
  });
});
