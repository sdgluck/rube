/**
 * The test that matters most in this feature.
 *
 * It enumerates every procedure the admin router exposes and asserts that all
 * but a named handful reject an unauthenticated caller. A new router added six
 * months from now inherits the gate automatically (it comes from `procedure`
 * in `_base.ts`), and if someone reaches for `publicProcedure` instead, this
 * fails until they add the path to `PUBLIC_PATHS` — which is a deliberate,
 * reviewable act rather than an oversight.
 */
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { ConfigStoreToken, REDACTED_SECRET } from "@tinkerbell/core";
import { JobsToken, registerJobs } from "@tinkerbell/jobs";
import { createTrpc } from "./index.ts";
import { t } from "./_base.ts";

// The router is built from a container now, so the test builds one. It used to
// have to set `DATA_DIR` before anything imported `@tinkerbell/db`, because
// that import opened a SQLite file wherever the environment pointed.
const c = createTestContainer({ overrides: registerJobs });
after(() => c.dispose());

const { appRouter } = createTrpc({ ...c.resolve(ServicesToken), jobs: c.resolve(JobsToken) });
const { getConfig } = c.resolve(ConfigStoreToken);

/**
 * The complete public surface of the admin API.
 *
 * `status` is what the SPA asks before it can render anything (it's the
 * answer to "do I need to log in?"), and the three handshake procedures are
 * unauthenticated by definition. `enable` is public so the feature can be
 * adopted at all — there is no session to authenticate with before auth is
 * on — and re-checks for a session itself once it is. `server` is the native
 * app's "is this a Tinkerbell, and which release?", asked before sign-in and
 * answering only a product name and version. Nothing else belongs here: not
 * health, not nav, not config.
 */
const PUBLIC_PATHS = new Set(["auth.status", "auth.start", "auth.poll", "auth.logout", "auth.enable", "auth.server"]);

function anonymousContext() {
  return {
    scope: c.createScope("test-request"),
    session: undefined,
    rawToken: undefined,
    resHeaders: new Headers(),
    secure: false,
    handshakeNonce: undefined,
    origin: "http://tinkerbell.test",
    ip: "test",
    authRequired: true,
  };
}

describe("admin router surface", () => {
  test("every procedure outside the public list rejects an unauthenticated caller", async () => {
    const caller = t.createCallerFactory(appRouter)(anonymousContext());
    const paths = Object.keys(appRouter._def.procedures);

    assert.ok(paths.length > 50, `expected the full router, got ${paths.length} procedures`);

    const reachable: string[] = [];
    for (const path of paths) {
      if (PUBLIC_PATHS.has(path)) continue;

      const fn = path.split(".").reduce<never>((acc, key) => (acc as never)[key], caller as never) as unknown as (
        input?: unknown,
      ) => Promise<unknown>;

      // The gate runs before input parsing, so calling with no input still
      // surfaces UNAUTHORIZED rather than a validation error — and a
      // procedure that *isn't* gated would run for real, which is why any
      // outcome other than UNAUTHORIZED counts as a failure here.
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
      `these procedures did not reject an anonymous caller — gate them with \`procedure\` ` +
        `from _base.ts, or add them to PUBLIC_PATHS if they are genuinely public:\n  ${reachable.join("\n  ")}`,
    );
  });

  test("the public list contains only auth procedures", () => {
    for (const path of PUBLIC_PATHS) {
      assert.ok(path.startsWith("auth."), `${path} is public but isn't part of the auth handshake`);
      assert.ok(path in appRouter._def.procedures, `${path} is listed as public but no longer exists`);
    }
  });

  test("poll refuses a caller with no handshake cookie instead of reaching plex.tv", async () => {
    const caller = t.createCallerFactory(appRouter)(anonymousContext());
    // The PIN id is not an input any more, so there is nothing for a caller to
    // guess or replay: without the cookie this process handed them, the
    // handshake doesn't exist. If this ever starts hitting the network, the
    // binding has been lost.
    const res = await caller.auth.poll();
    assert.equal(res.status, "expired");
  });

  test("poll refuses a handshake nonce this process never issued", async () => {
    const caller = t.createCallerFactory(appRouter)({
      ...anonymousContext(),
      handshakeNonce: "a".repeat(64),
    });
    const res = await caller.auth.poll();
    assert.equal(res.status, "expired");
  });

  test("config.save cannot write the auth keys", async () => {
    const caller = t.createCallerFactory(appRouter)({ ...anonymousContext(), authRequired: false });
    // Omitted from the input schema, so zod strips them and the loop never
    // sees them — the only writers are the `auth` mutations that check.
    await caller.config.save({ admin_allowed_user_ids: [999], admin_auth_enabled: true } as never);
    assert.deepEqual(getConfig("admin_allowed_user_ids"), undefined);
    assert.equal(getConfig("admin_auth_enabled"), undefined);
  });

  test("saving an *Arr instance whose key came back redacted keeps the stored key", async () => {
    const caller = t.createCallerFactory(appRouter)({ ...anonymousContext(), authRequired: false });

    await caller.config.save({
      global_arr_instances: [
        { id: "hd", service: "radarr", name: "HD", url: "http://radarr:7878", apiKey: "real-hd-key" },
        { id: "uhd", service: "radarr", name: "4K", url: "http://radarr4k:7878", apiKey: "real-4k-key" },
      ],
    });

    // What a form round-trip looks like: one instance renamed, both keys still
    // the sentinel the browser was given because nobody retyped them.
    await caller.config.save({
      global_arr_instances: [
        { id: "hd", service: "radarr", name: "HD", url: "http://radarr:7878", apiKey: REDACTED_SECRET },
        { id: "uhd", service: "radarr", name: "UHD", url: "http://radarr4k:7878", apiKey: REDACTED_SECRET },
      ],
    });

    const saved = getConfig("global_arr_instances");
    assert.deepEqual(
      saved?.map((i) => [i.name, i.apiKey]),
      [
        ["HD", "real-hd-key"],
        ["UHD", "real-4k-key"],
      ],
    );
  });

  /**
   * The agent API's read-only promise, enforced where it can't be forgotten.
   *
   * Every mutation and subscription on the router — public ones included — is
   * called as an API-key caller, and every one must be refused before it
   * runs. A new mutation inherits this from `procedure`; the test exists so
   * that one built some other way can't quietly hand a key write access.
   */
  test("an API-key caller is refused every mutation, before it runs", async () => {
    const caller = t.createCallerFactory(appRouter)({
      ...anonymousContext(),
      apiKey: { id: "k", name: "test-agent" },
    });
    const procedures = appRouter._def.procedures as unknown as Record<string, { _def: { type: string } }>;
    const writes = Object.entries(procedures).filter(([, p]) => p._def.type !== "query");
    assert.ok(writes.length > 50, `expected every mutation, got ${writes.length}`);

    const allowed: string[] = [];
    for (const [path] of writes) {
      const fn = path.split(".").reduce<never>((acc, key) => (acc as never)[key], caller as never) as unknown as (
        input?: unknown,
      ) => Promise<unknown>;
      await fn(undefined).then(
        () => allowed.push(`${path} (resolved)`),
        (err: { code?: string }) => {
          if (err?.code !== "FORBIDDEN") allowed.push(`${path} (${err?.code ?? "unknown error"})`);
        },
      );
    }
    assert.deepEqual(allowed, [], `these writes were not refused to an API key:\n  ${allowed.join("\n  ")}`);
  });

  test("an API-key caller may query even with admin auth on", async () => {
    const caller = t.createCallerFactory(appRouter)({
      ...anonymousContext(),
      apiKey: { id: "k", name: "test-agent" },
    });
    assert.ok(Array.isArray(await caller.notificationEventTypes()));
  });

  test("with auth switched off, the gate stands aside", async () => {
    const caller = t.createCallerFactory(appRouter)({ ...anonymousContext(), authRequired: false });
    // `notificationEventTypes` is a pure constant lookup, so it exercises the
    // middleware chain without touching Plex or the database.
    const types = await caller.notificationEventTypes();
    assert.ok(Array.isArray(types));
  });
});
