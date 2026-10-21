/**
 * The native app's contract, checked from the server's side.
 *
 * `NATIVE_PROCEDURES` lists what the Swift and Kotlin clients call and the
 * schema each answers with; the models in `native/` are generated from it.
 * Three ways that could silently stop being true, each a test here:
 *
 * - a procedure renamed or moved, so the app calls something that 404s;
 * - a schema listed but not attached, so nothing checks what is actually sent
 *   and the generated model describes a shape nobody validates;
 * - a schema codegen can't represent (a date, a transform), which would
 *   otherwise surface as a codegen crash or, worse, a model that guesses.
 *
 * And then the calls themselves: every input-less query is run as a signed-in
 * caller against a real container. Output validation is on, so a resolver that
 * answers outside its schema fails here as the 500 it would be in production.
 */
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { NATIVE_PROCEDURES, type NativeRouter } from "@rube/contracts/native-api";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { DbToken, plexUsers } from "@rube/db";
import { JobsToken, registerJobs } from "@rube/jobs";
import { createTrpc } from "./index.ts";
import { t } from "./_base.ts";

delete process.env.RUBE_DISABLE_AUTH;

const c = createTestContainer({ overrides: registerJobs });
after(() => c.dispose());

const deps = { ...c.resolve(ServicesToken), jobs: c.resolve(JobsToken) };
const { appRouter, portalRouter, createAdminContext, createPortalContext } = createTrpc(deps);
const { setConfig } = deps.config;
const { createPlexSession } = deps.sessions;

const OWNER_TOKEN = "plex-token-for-tests";
setConfig("admin_auth_enabled", true);
setConfig("global_plex_token", OWNER_TOKEN);
setConfig("global_plex_owner_id", 42);
setConfig("global_plex_owner_username", "owner");
setConfig("global_plex_owner_token_hash", createHash("sha256").update(OWNER_TOKEN).digest("hex"));
c.resolve(DbToken).insert(plexUsers).values({ userId: 42, username: "owner", label: "owner", syncedAt: 0 }).run();

interface ProcedureDef {
  type: "query" | "mutation" | "subscription";
  inputs: unknown[];
  output?: unknown;
}

const ROUTERS = {
  admin: appRouter,
  portal: portalRouter,
} satisfies Record<NativeRouter, unknown>;

function procedures(router: NativeRouter): Record<string, { _def: ProcedureDef }> {
  return (ROUTERS[router] as unknown as { _def: { procedures: Record<string, { _def: ProcedureDef }> } })._def
    .procedures;
}

for (const router of Object.keys(NATIVE_PROCEDURES) as NativeRouter[]) {
  describe(`the ${router} procedures the native app calls`, () => {
    const manifest = NATIVE_PROCEDURES[router] as Record<string, z.ZodType | null>;
    const procs = procedures(router);

    test("all exist, with the listed schema attached as their output", () => {
      const problems: string[] = [];
      for (const [path, schema] of Object.entries(manifest)) {
        const proc = procs[path];
        if (!proc) problems.push(`${path}: no such procedure`);
        else if (schema && proc._def.output !== schema) problems.push(`${path}: listed schema is not its .output()`);
        else if (!schema && proc._def.output) problems.push(`${path}: has an output schema the manifest doesn't list`);
      }
      assert.deepEqual(problems, []);
    });

    test("every schema is representable as JSON Schema, so codegen never guesses", () => {
      for (const [path, schema] of Object.entries(manifest)) {
        if (!schema) continue;
        assert.doesNotThrow(() => z.toJSONSchema(schema, { io: "output", unrepresentable: "throw" }), path);
      }
      for (const [path] of Object.entries(manifest)) {
        const input = procs[path]?._def.inputs[0];
        if (!input) continue;
        assert.doesNotThrow(
          () => z.toJSONSchema(input as z.ZodType, { io: "input", unrepresentable: "throw" }),
          `${path} input`,
        );
      }
    });
  });
}

/**
 * Errors a query may legitimately answer with in an empty test container — no
 * Plex configured (412), nothing seeded (404), a component switched off (403).
 * An output that fails its schema is INTERNAL_SERVER_ERROR, which is not here.
 */
const EXPECTED = new Set(["PRECONDITION_FAILED", "NOT_FOUND", "FORBIDDEN", "BAD_REQUEST"]);

async function callEach(router: NativeRouter, caller: unknown) {
  const manifest = NATIVE_PROCEDURES[router] as Record<string, z.ZodType | null>;
  const procs = procedures(router);
  const failures: string[] = [];
  let answered = 0;
  for (const path of Object.keys(manifest)) {
    const def = procs[path]?._def;
    // Inputs and mutations need a scenario each; their own router tests run them.
    if (!def || def.type !== "query" || def.inputs.length > 0) continue;
    const fn = path
      .split(".")
      .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], caller) as () => Promise<unknown>;
    try {
      await fn();
      answered++;
    } catch (err) {
      if (err instanceof TRPCError && EXPECTED.has(err.code)) continue;
      failures.push(`${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { failures, answered };
}

test("every input-less admin query answers within its schema", async () => {
  const raw = createPlexSession(42, "owner", "admin");
  const ctx = createAdminContext({
    req: new Request("http://rube.test/api/trpc", { headers: { authorization: `Bearer ${raw}` } }),
    resHeaders: new Headers(),
  });
  const { failures, answered } = await callEach("admin", t.createCallerFactory(appRouter)(ctx));
  assert.deepEqual(failures, []);
  assert.ok(answered > 5, `only ${answered} admin queries answered — the scenario isn't exercising anything`);
});

test("every input-less portal query answers within its schema", async () => {
  const raw = createPlexSession(42, "owner", "portal");
  const ctx = createPortalContext({
    req: new Request("http://rube.test/api/trpc", { headers: { authorization: `Bearer ${raw}` } }),
    resHeaders: new Headers(),
  });
  const { failures, answered } = await callEach("portal", portalRouter.createCaller(ctx));
  assert.deepEqual(failures, []);
  assert.ok(answered > 3, `only ${answered} portal queries answered`);
});
