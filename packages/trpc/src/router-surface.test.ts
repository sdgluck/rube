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
import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `@tinkerbell/db` opens its SQLite file at import time, so point it at a
// scratch directory before anything pulls it in. Nothing here runs a query —
// every call under test is refused by the gate long before the database —
// but the file would otherwise land in the repo root.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "tinkerbell-trpc-test-"));

/**
 * The complete public surface of the admin API.
 *
 * `status` is what the SPA asks before it can render anything (it's the
 * answer to "do I need to log in?"), and the three handshake procedures are
 * unauthenticated by definition. `enable` is public so the feature can be
 * adopted at all — there is no session to authenticate with before auth is
 * on — and re-checks for a session itself once it is. Nothing else belongs
 * here: not health, not nav, not config.
 */
const PUBLIC_PATHS = new Set(["auth.status", "auth.start", "auth.poll", "auth.logout", "auth.enable"]);

let appRouter: typeof import("./index.ts").appRouter;
let t: typeof import("./_base.ts").t;

before(async () => {
  // Most of this suite is refused by the gate long before the database, but
  // the `config.save` case below asserts on what was actually written, so the
  // scratch DB needs a real schema.
  execFileSync(process.execPath, [join(import.meta.dirname, "..", "..", "db", "src", "migrate.ts")], {
    env: { ...process.env },
    stdio: "ignore",
  });
  ({ appRouter } = await import("./index.ts"));
  ({ t } = await import("./_base.ts"));
});

function anonymousContext() {
  return {
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
    const { getConfig } = await import("@tinkerbell/core");
    assert.deepEqual(getConfig("admin_allowed_user_ids"), undefined);
    assert.equal(getConfig("admin_auth_enabled"), undefined);
  });

  test("saving an *Arr instance whose key came back redacted keeps the stored key", async () => {
    const caller = t.createCallerFactory(appRouter)({ ...anonymousContext(), authRequired: false });
    const { getConfig, REDACTED_SECRET } = await import("@tinkerbell/core");

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

  test("with auth switched off, the gate stands aside", async () => {
    const caller = t.createCallerFactory(appRouter)({ ...anonymousContext(), authRequired: false });
    // `notificationEventTypes` is a pure constant lookup, so it exercises the
    // middleware chain without touching Plex or the database.
    const types = await caller.notificationEventTypes();
    assert.ok(Array.isArray(types));
  });
});
