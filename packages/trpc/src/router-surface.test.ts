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
  ({ appRouter } = await import("./index.ts"));
  ({ t } = await import("./_base.ts"));
});

function anonymousContext() {
  return {
    session: undefined,
    rawToken: undefined,
    resHeaders: new Headers(),
    secure: false,
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

  test("with auth switched off, the gate stands aside", async () => {
    const caller = t.createCallerFactory(appRouter)({ ...anonymousContext(), authRequired: false });
    // `notificationEventTypes` is a pure constant lookup, so it exercises the
    // middleware chain without touching Plex or the database.
    const types = await caller.notificationEventTypes();
    assert.ok(Array.isArray(types));
  });
});
