/**
 * The portal's equivalent of `router-surface.test.ts`.
 *
 * The portal is the surface a shared user reaches, so two things need pinning:
 * that everything except the sign-in handshake and the two screens the login
 * page itself renders requires a session, and that the handshake cannot be
 * completed by a caller who didn't begin it. The second is the one that had a
 * hole — `auth.poll` used to take the plex.tv PIN id as an input, and plex.tv
 * hands a PIN's token to anyone who asks with the client id that minted it.
 */
import { describe, test, after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { JobsToken, registerJobs } from "@tinkerbell/jobs";
import { createTrpc } from "./index.ts";
import { createHandshakes } from "./handshake.ts";

const c = createTestContainer({ overrides: registerJobs });
after(() => c.dispose());

const trpcDeps = { ...c.resolve(ServicesToken), jobs: c.resolve(JobsToken) };
const { portalRouter } = createTrpc(trpcDeps);
const { createHandshake } = createHandshakes(trpcDeps);

// As in `router-surface.test.ts`: `@tinkerbell/db` opens its SQLite file at
// import time, so point it somewhere disposable first.

/**
 * The complete public surface of the portal API. `personalizationStatus` and
 * `branding` are what the login screen renders itself from, and the three
 * handshake procedures are unauthenticated by definition, as is `auth.server`,
 * which the native app asks before sign-in. A shared user's own data is never
 * in here.
 *
 * The two `match.guest.*` procedures are the movie-match invite screen: how
 * somebody with no account on this server joins a room they were sent. Both
 * need the room's invite secret, and neither touches anything but that room.
 */
const PUBLIC_PATHS = new Set([
  "personalizationStatus",
  "branding",
  "auth.start",
  "auth.poll",
  "auth.logout",
  "auth.server",
  "match.guest.preview",
  "match.guest.join",
]);

type PortalContext = import("./portal.router.ts").PortalContext;

function anonymousContext(): PortalContext {
  return {
    session: undefined,
    rawToken: undefined,
    resHeaders: new Headers(),
    secure: false,
    handshakeNonce: undefined,
    origin: "http://portal.tinkerbell.test",
    ip: "test",
  };
}

async function caller(ctx: Partial<PortalContext> = {}) {
  const { initTRPC } = await import("@trpc/server");
  const factory = initTRPC.context<PortalContext>().create();
  return factory.createCallerFactory(portalRouter)({ ...anonymousContext(), ...ctx });
}

/** The procedure map, keyed by dotted path the way tRPC stores it. */
function procedures(): Record<string, { _def: { inputs: unknown[] } }> {
  return portalRouter._def.procedures as unknown as Record<string, { _def: { inputs: unknown[] } }>;
}

describe("portal router surface", () => {
  test("every procedure outside the public list rejects a caller with no session", async () => {
    const client = await caller();
    const paths = Object.keys(procedures());
    assert.ok(paths.length > 5, `expected the full portal router, got ${paths.length} procedures`);

    const reachable: string[] = [];
    for (const path of paths) {
      if (PUBLIC_PATHS.has(path)) continue;
      const fn = path.split(".").reduce<never>((acc, key) => (acc as never)[key], client as never) as unknown as (
        input?: unknown,
      ) => Promise<unknown>;
      await fn(undefined).then(
        () => reachable.push(`${path} (resolved)`),
        (err: { code?: string }) => {
          if (err?.code !== "UNAUTHORIZED") reachable.push(`${path} (${err?.code ?? "unknown error"})`);
        },
      );
    }

    assert.deepEqual(
      reachable,
      [],
      `these portal procedures did not reject a caller with no session — use \`userProcedure\`, ` +
        `or add them to PUBLIC_PATHS if the login screen genuinely needs them:\n  ${reachable.join("\n  ")}`,
    );
  });

  test("the public list holds only the handshake, the login screen's own two queries, and the invite screen", () => {
    for (const path of PUBLIC_PATHS) {
      assert.ok(
        path.startsWith("auth.") ||
          path.startsWith("match.guest.") ||
          path === "personalizationStatus" ||
          path === "branding",
        `${path} is public but isn't part of the sign-in or invite screen`,
      );
      assert.ok(path in procedures(), `${path} is listed as public but no longer exists`);
    }
  });

  /** What the procedure's input schema makes of a hostile payload. */
  function parsedInput(path: string, raw: unknown): unknown {
    const inputs = procedures()[path]._def.inputs as { parse(v: unknown): unknown }[];
    assert.equal(inputs.length, 1, `${path} should have exactly one input schema`);
    return inputs[0].parse(raw);
  }

  test("poll accepts no PIN id from the caller", () => {
    // The regression this guards: an input schema here means a caller can name
    // the PIN to redeem, and plex.tv's ids are sequential — so polling around
    // the live range while somebody approves theirs collects their session.
    // The native app sends its handshake nonce, which is as unguessable as the
    // cookie it stands in for; anything shaped like a PIN id is dropped.
    assert.deepEqual(parsedInput("auth.poll", { handshake: "n", pinId: 5, id: 5, code: "x" }), { handshake: "n" });
  });

  test("start accepts no forwardUrl from the caller", () => {
    // Same shape of bug in the other direction: a caller-chosen return address
    // makes a genuine app.plex.tv link that lands the user on their page. The
    // only thing a caller says is which kind of client it is.
    assert.deepEqual(parsedInput("auth.start", { client: "native", forwardUrl: "https://evil.example" }), {
      client: "native",
    });
  });

  test("poll refuses a caller with no handshake cookie instead of reaching plex.tv", async () => {
    const client = await caller();
    const res = await client.auth.poll();
    assert.equal(res.status, "expired");
  });

  test("poll refuses a nonce this process never issued", async () => {
    const client = await caller({ handshakeNonce: "a".repeat(64) });
    const res = await client.auth.poll();
    assert.equal(res.status, "expired");
  });

  test("a portal nonce cannot redeem an admin handshake", async () => {
    // The two scopes keep separate cookies, separate sessions and separate
    // plex.tv client ids; the handshake store is namespaced for the same
    // reason. A nonce minted for the admin flow is not a portal handshake.
    const adminNonce = createHandshake("admin", 4242);
    const client = await caller({ handshakeNonce: adminNonce });
    const res = await client.auth.poll();
    assert.equal(res.status, "expired");
  });
});

describe("a shared user's own data", () => {
  /** A signed-in portal caller for user 7. */
  async function signedIn(userId = 7) {
    return caller({ session: { userId, username: `user${userId}` } });
  }

  test('"Not for me" records the row, not a film nobody mentioned', async () => {
    // It used to write the *collection's* name into `excludedTitles`, which every
    // consumer matches against item titles: the row was rebuilt identically on
    // the next run, and the entry then appeared in the user's "Never recommend"
    // list as a film they had never named.
    const client = await signedIn();
    await client.notInterested({ title: "Directed by Christopher Nolan" });

    const prefs = await client.preferences.get();
    assert.deepEqual(prefs.preferences.excludedCollections, ["Directed by Christopher Nolan"]);
    assert.deepEqual(prefs.preferences.excludedTitles, []);

    // Idempotent.
    await client.notInterested({ title: "Directed by Christopher Nolan" });
    assert.equal((await client.preferences.get()).preferences.excludedCollections.length, 1);
  });

  test("saving preferences from the form does not wipe what the form omits", async () => {
    // Its own user: these tests share one database, and preferences are per user.
    const client = await signedIn(8);
    await client.notInterested({ title: "A row I hid" });

    // What the portal's form sends: the fields it renders, and nothing else.
    await client.preferences.set({
      optedIn: true,
      preferences: { moods: ["cosy"], excludedTitles: ["Cats"] },
    });

    const prefs = await client.preferences.get();
    assert.deepEqual(prefs.preferences.moods, ["cosy"]);
    assert.deepEqual(prefs.preferences.excludedTitles, ["Cats"]);
    assert.deepEqual(prefs.preferences.excludedCollections, ["A row I hid"], "the other tab's work survives a save");
    assert.equal(prefs.optedIn, true);
  });

  test("a present key still clears a list", async () => {
    const client = await signedIn(9);
    await client.preferences.set({ optedIn: false, preferences: { excludedTitles: ["Cats"] } });
    await client.preferences.set({ optedIn: false, preferences: { excludedTitles: [] } });
    assert.deepEqual((await client.preferences.get()).preferences.excludedTitles, []);
  });

  const SMTP_OFF = { host: "", port: 0, secure: false, user: "", password: "", from: "" };
  const SMTP_ON = { ...SMTP_OFF, host: "smtp.example.test", port: 587, from: "tinkerbell@example.test" };

  test("a component needs its feature as well as its switch", async () => {
    // Leaving soon on a server with cleanup off could only ever say nothing was
    // leaving, and the digest without SMTP saved an address nothing would use.
    const client = await signedIn(10);
    const { setConfig } = trpcDeps.config;
    setConfig("cleanup_enabled", false);
    setConfig("global_smtp", SMTP_OFF);
    let on = await client.components();
    assert.equal(on["tab.leaving"], false);
    assert.equal(on["action.keep"], false, "a tab's actions go with it");
    assert.equal(on["tastes.digest"], false);
    assert.equal(on["tab.collections"], true);

    setConfig("cleanup_enabled", true);
    setConfig("global_smtp", SMTP_ON);
    on = await client.components();
    assert.equal(on["tab.leaving"], true);
    assert.equal(on["action.keep"], true);
    assert.equal(on["tastes.digest"], true);
  });

  describe("a switched-off component", () => {
    const { setConfig } = trpcDeps.config;
    beforeEach(() => setConfig("cleanup_enabled", true));
    afterEach(() => setConfig("portal_components_hidden", []));

    async function refused(fn: () => Promise<unknown>) {
      await assert.rejects(fn, (err: { code?: string }) => {
        assert.equal(err.code, "FORBIDDEN");
        return true;
      });
    }

    test("is refused by the server, not only hidden", async () => {
      const client = await signedIn(11);
      setConfig("portal_components_hidden", ["tab.collections", "tab.leaving", "tab.tastes"]);
      await refused(() => client.myCollections());
      await refused(() => client.notInterested({ title: "A row" }));
      await refused(() => client.leavingSoon());
      await refused(() => client.voteKeep({ ratingKey: "made-up", keep: true }));
      await refused(() => client.preferences.set({ optedIn: true, preferences: { moods: ["Cosy"] } }));
    });

    test("never strands a keep vote its owner wants to withdraw", async () => {
      const client = await signedIn(11);
      setConfig("portal_components_hidden", ["action.keep"]);
      assert.deepEqual(await client.voteKeep({ ratingKey: "made-up", keep: false }), { ok: true });
    });

    test("keeps a hidden section's stored answer through a save", async () => {
      const client = await signedIn(12);
      await client.preferences.set({ optedIn: true, preferences: { moods: ["Cosy"] } });

      setConfig("portal_components_hidden", ["tastes.moods"]);
      await client.preferences.set({ optedIn: true, preferences: { moods: [], excludedTitles: ["Cats"] } });

      const prefs = (await client.preferences.get()).preferences;
      assert.deepEqual(prefs.moods, ["Cosy"], "the hidden section's key was dropped, not applied");
      assert.deepEqual(prefs.excludedTitles, ["Cats"], "a visible section still saves");
    });
  });

  test("voteKeep refuses a rating key no rule has queued", async () => {
    // The vote is shown on the admin's queue with the voter's name against it, so
    // an unchecked key let a shared user put named rows there for items nothing
    // had ever matched.
    const client = await signedIn();
    // On, so the refusal under test is the queue check and not the switch.
    trpcDeps.config.setConfig("cleanup_enabled", true);
    await assert.rejects(
      () => client.voteKeep({ ratingKey: "made-up", keep: true }),
      (err: { code?: string }) => {
        assert.equal(err.code, "NOT_FOUND");
        return true;
      },
    );
  });

  test("withdrawing a vote is always allowed", async () => {
    // Removing something that isn't there is not an error, and refusing it would
    // strand a vote whose candidate has since been actioned.
    const client = await signedIn();
    assert.deepEqual(await client.voteKeep({ ratingKey: "made-up", keep: false }), { ok: true });
  });
});
