/**
 * Movie match on the portal: who gets to do what.
 *
 * The domain's own tests cover the rules; these cover the doors, because the
 * portal port is one the admin is told they may expose. Three kinds of caller
 * reach these procedures — a session, a guest token, and nobody — and the one
 * to watch is the guest: they must get into their room and nowhere else, not
 * even the rest of the portal.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { initTRPC } from "@trpc/server";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { ConfigStoreToken } from "@tinkerbell/core";
import { DbToken, mediaItems, plexSections, plexUsers } from "@tinkerbell/db";
import { JobsToken, registerJobs } from "@tinkerbell/jobs";
import { createTrpc } from "./index.ts";

const c = createTestContainer({ overrides: registerJobs });
after(() => c.dispose());

const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const { portalRouter } = createTrpc({ ...c.resolve(ServicesToken), jobs: c.resolve(JobsToken) });

type PortalContext = import("./portal.router.ts").PortalContext;

function caller(ctx: Partial<PortalContext>) {
  return initTRPC.context<PortalContext>().create().createCallerFactory(portalRouter)({
    resHeaders: new Headers(),
    secure: false,
    origin: "http://portal.tinkerbell.test",
    ip: "test",
    ...ctx,
  });
}

const alice = caller({ session: { userId: 1, username: "alice" } });
const nobody = caller({});

async function rejects(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: { code?: string }) => e.code === code);
}

before(() => {
  db.insert(plexUsers).values({ userId: 1, username: "alice", label: "alice", syncedAt: 0 }).run();
  db.insert(plexSections).values({ key: "1", title: "Films", type: "movie", syncedAt: 0 }).run();
  for (const key of ["a", "b", "c"]) {
    db.insert(mediaItems)
      .values({ ratingKey: key, title: key, sectionId: "1", sectionTitle: "Films", type: "movie", syncedAt: 0 })
      .run();
  }
});

describe("movie match on the portal", () => {
  test("is shut while movie match is off, for guests as well", async () => {
    setConfig("match_enabled", false);
    await rejects(alice.match.libraries(), "FORBIDDEN");
    await rejects(nobody.match.guest.preview({ code: "ABCD", invite: "x" }), "FORBIDDEN");
  });

  test("a guest on the invite link gets into the room, and nothing else", async () => {
    setConfig("match_enabled", true);
    const { code, invite } = await alice.match.create({ sectionId: "1", filters: {} });
    const other = await alice.match.create({ sectionId: "1", filters: {} });

    assert.deepEqual((await nobody.match.guest.preview({ code, invite })).members, ["alice"]);
    await rejects(nobody.match.guest.join({ code, invite: other.invite, name: "Dee" }), "NOT_FOUND");
    const { token } = await nobody.match.guest.join({ code, invite, name: "Dee" });
    const dee = caller({ matchGuest: token });

    // Plex isn't configured here: the deck still deals, without synopses.
    const page = await dee.match.deck({ code, exclude: [], limit: 10 });
    assert.equal(page.films.length, 3);
    assert.ok(page.films.every((f) => f.summary === ""));
    await dee.match.swipe({ code, ratingKey: "a", liked: true });
    await alice.match.swipe({ code, ratingKey: "a", liked: true });
    const state = await dee.match.state({ code });
    assert.equal(state.matches[0]?.unanimous, true);
    assert.equal(state.plexServerId, null, "a guest gets no link into the server's Plex");

    // Not another room, and not the rest of the portal.
    await rejects(dee.match.state({ code: other.code }), "FORBIDDEN");
    await rejects(dee.match.create({ sectionId: "1", filters: {} }), "UNAUTHORIZED");
    await rejects(dee.match.libraries(), "UNAUTHORIZED");
    await rejects(dee.me(), "UNAUTHORIZED");
    await rejects(dee.preferences.get(), "UNAUTHORIZED");
  });

  test("a member's room still answers when Plex doesn't say which server it is", async () => {
    // `machineIdentifier` is optional in Plex's identity. Returned as undefined
    // it failed the room's output schema, and every poll of the room was a 500.
    const plex = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ MediaContainer: { friendlyName: "Anonymous" } }));
    });
    await new Promise<void>((ok) => plex.listen(0, "127.0.0.1", ok));
    after(() => new Promise<void>((ok) => plex.close(() => ok())));
    const { port } = plex.address() as AddressInfo;
    setConfig("global_plex_url", `http://127.0.0.1:${port}`);
    setConfig("global_plex_token", "t");
    setConfig("match_enabled", true);

    const { code } = await alice.match.create({ sectionId: "1", filters: {} });
    assert.equal((await alice.match.state({ code })).plexServerId, null);
  });

  test("nobody at all is refused before anything else is checked", async () => {
    setConfig("match_enabled", true);
    await rejects(nobody.match.state({ code: "ABCD" }), "UNAUTHORIZED");
    await rejects(nobody.match.create({ sectionId: "1", filters: {} }), "UNAUTHORIZED");
  });
});
