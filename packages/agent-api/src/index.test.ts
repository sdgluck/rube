/**
 * The agent API end to end: a real container, a real tRPC router, real keys,
 * and a mock Plex on a real port — driven by constructing `Request`s, exactly
 * as the server hands them over.
 *
 * Three things matter most and each has a test of its own: nothing answers
 * without a valid key, every tool runs without reaching for a write, and both
 * transports return the same answer for the same question.
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { JobsToken, registerJobs } from "@rube/jobs";
import { createTrpc } from "@rube/trpc";
import { startMockPlex, type MockPlex } from "@rube/test-support";
import { createAgentApi, isAgentApiPath, SUPPORTED_PROTOCOL_VERSIONS, TOOLS } from "./index.ts";
import { argsFromQuery } from "./rest.ts";
import { inputSchemaOf } from "./json-schema.ts";
import { TOOLS_BY_NAME } from "./tools.ts";

const c = createTestContainer({ overrides: registerJobs });
after(() => c.dispose());
const services = c.resolve(ServicesToken);
const { createCaller } = createTrpc({ ...services, jobs: c.resolve(JobsToken) });
const { handleAgentRequest } = createAgentApi({
  createCaller,
  verifyApiKey: services.apiKeys.verifyApiKey,
  scope: services.scope,
  version: "9.9.9",
});

const ORIGIN = "http://rube.test";
const { key } = services.apiKeys.createApiKey("test agent");

let plex: MockPlex;
before(async () => {
  plex = await startMockPlex({
    sections: [{ key: "1", title: "Movies", type: "movie" }],
    items: [{ ratingKey: "101", title: "Heat", sectionId: "1", guids: [], labels: [], year: 1995 }],
  });
  services.config.setConfig("global_plex_url", plex.origin);
  services.config.setConfig("global_plex_token", "token");
});
after(() => plex.close());

function request(path: string, init: RequestInit & { key?: string | null } = {}): Promise<Response> {
  const { key: k = key, headers, ...rest } = init;
  return handleAgentRequest(
    new Request(`${ORIGIN}${path}`, {
      ...rest,
      headers: { "content-type": "application/json", ...(k ? { authorization: `Bearer ${k}` } : {}), ...headers },
    }),
  );
}

let rpcId = 0;
async function rpc(method: string, params?: unknown): Promise<{ result?: any; error?: { code: number } }> {
  const res = await request("/mcp", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  assert.equal(res.status, 200);
  return res.json();
}

describe("agent api: authentication", () => {
  test("no key, a wrong key and a revoked key are all refused, on both transports", async () => {
    const revoked = services.apiKeys.createApiKey("revoked");
    services.apiKeys.revokeApiKey(revoked.id);

    for (const k of [null, "tbk_nope", revoked.key]) {
      for (const path of ["/mcp", "/api/v1", "/api/v1/tools/get_overview", "/api/v1/openapi.json"]) {
        const res = await request(path, { method: "POST", key: k, body: "{}" });
        assert.equal(res.status, 401, `${path} with ${k} should be 401`);
        assert.match(res.headers.get("www-authenticate") ?? "", /^Bearer/);
      }
    }
  });

  test("X-Api-Key is accepted as well as a bearer token", async () => {
    const res = await request("/api/v1", { key: null, headers: { "x-api-key": key } });
    assert.equal(res.status, 200);
  });

  test("a key in the query string is not", async () => {
    const res = await request(`/api/v1?api_key=${key}`, { key: null });
    assert.equal(res.status, 401);
  });

  test("the routes this module owns are exactly these", () => {
    for (const path of ["/mcp", "/api/v1", "/api/v1/", "/api/v1/tools/search", "/api/v1/openapi.json"]) {
      assert.ok(isAgentApiPath(path), path);
    }
    for (const path of ["/api/trpc/rules.list", "/api/v10", "/mcpx", "/api/plex-image"]) {
      assert.ok(!isAgentApiPath(path), path);
    }
  });
});

describe("agent api: MCP", () => {
  test("initialize echoes a protocol version it supports, and offers the newest otherwise", async () => {
    const known = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: {} });
    assert.equal(known.result.protocolVersion, "2025-06-18");
    assert.equal(known.result.serverInfo.version, "9.9.9");
    assert.ok(known.result.capabilities.tools);

    const unknown = await rpc("initialize", { protocolVersion: "1999-01-01" });
    assert.equal(unknown.result.protocolVersion, SUPPORTED_PROTOCOL_VERSIONS[0]);
  });

  test("a notification is accepted with no body", async () => {
    const res = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    assert.equal(res.status, 202);
    assert.equal(await res.text(), "");
  });

  test("GET has no stream to open", async () => {
    const res = await request("/mcp", { method: "GET" });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST");
  });

  test("malformed JSON is a parse error, an unknown method is method-not-found", async () => {
    const bad = await request("/mcp", { method: "POST", body: "{nope" });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, -32700);

    assert.equal((await rpc("resources/list")).error?.code, -32601);
  });

  test("tools/list advertises every tool as a read-only object schema", async () => {
    const { result } = await rpc("tools/list");
    assert.deepEqual(
      result.tools.map((t: { name: string }) => t.name),
      TOOLS.map((t) => t.name),
    );
    for (const tool of result.tools) {
      assert.equal(tool.inputSchema.type, "object", tool.name);
      assert.equal(tool.annotations.readOnlyHint, true, tool.name);
      assert.ok(tool.description.length > 40, `${tool.name} needs a description a model can choose by`);
    }
  });

  test("an unknown tool is a protocol error; bad arguments are a tool error the model can read", async () => {
    assert.equal((await rpc("tools/call", { name: "delete_everything", arguments: {} })).error?.code, -32602);

    const bad = await rpc("tools/call", { name: "get_rule", arguments: {} });
    assert.equal(bad.result.isError, true);
    assert.match(bad.result.content[0].text, /ruleId/);
  });

  test("batched messages get batched answers", async () => {
    const res = await request("/mcp", {
      method: "POST",
      body: JSON.stringify([
        { jsonrpc: "2.0", id: "a", method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: "b", method: "ping" },
      ]),
    });
    const body = await res.json();
    assert.deepEqual(
      body.map((r: { id: string }) => r.id),
      ["a", "b"],
    );
  });
});

describe("agent api: tools", () => {
  const rule = services.rules.createRule({
    name: "Nineties thrillers",
    type: "smart_filter",
    config: {
      sections: ["Movies"],
      smartFilter: {
        kind: "group",
        combinator: "all",
        children: [{ kind: "leaf", field: "genre", op: "=", value: "Thriller" }],
      },
    },
  });

  /** Enough arguments for every tool to get past validation. */
  const SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
    get_rule: { ruleId: rule.id },
    explain_item_for_rule: { ruleId: rule.id, ratingKey: "101" },
    get_rule_run: { runId: "no-such-run" },
    get_job_run: { runId: "no-such-run" },
    search: { query: "heat" },
    get_collection: { ratingKey: "999" },
    get_media_item: { ratingKey: "101" },
  };

  test("every tool runs without being refused a write", async () => {
    for (const tool of TOOLS) {
      const { result } = await rpc("tools/call", { name: tool.name, arguments: SAMPLE_ARGS[tool.name] ?? {} });
      const text: string = result.content[0].text;
      // A missing run or collection is a fine answer here. A tool that reaches
      // for a mutation is not, and neither is one that doesn't validate its own
      // sample arguments.
      assert.doesNotMatch(text, /read-only/, `${tool.name} tried to write: ${text}`);
      assert.doesNotMatch(text, /Invalid arguments/, `${tool.name}: ${text}`);
    }
  });

  test("list_rules and get_rule describe a rule, criteria in English", async () => {
    const listed = JSON.parse((await rpc("tools/call", { name: "list_rules", arguments: {} })).result.content[0].text);
    const row = listed.find((r: { id: string }) => r.id === rule.id);
    assert.equal(row.name, "Nineties thrillers");
    assert.deepEqual(row.sections, ["Movies"]);
    assert.equal(row.enabled, true);
    assert.equal("config" in row, false, "the list should not carry every rule's full config");

    const got = JSON.parse(
      (await rpc("tools/call", { name: "get_rule", arguments: { ruleId: rule.id } })).result.content[0].text,
    );
    assert.equal(got.id, rule.id);
    assert.match(got.criteria ?? "", /Thriller/);
    assert.deepEqual(got.recentRuns, []);
  });

  test("list_library_sections reaches Plex", async () => {
    const { result } = await rpc("tools/call", { name: "list_library_sections", arguments: {} });
    assert.equal(result.isError, false, result.content[0].text);
    assert.deepEqual(
      JSON.parse(result.content[0].text).map((s: { title: string }) => s.title),
      ["Movies"],
    );
  });

  test("get_config never shows a secret", async () => {
    const { result } = await rpc("tools/call", { name: "get_config", arguments: { keyPrefix: "global_plex" } });
    const settings = JSON.parse(result.content[0].text).settings;
    assert.ok("global_plex_url" in settings);
    assert.notEqual(settings.global_plex_token, "token");
  });
});

describe("agent api: REST", () => {
  test("the index and the OpenAPI document list every tool", async () => {
    const index = await (await request("/api/v1")).json();
    assert.deepEqual(
      index.tools.map((t: { name: string }) => t.name),
      TOOLS.map((t) => t.name),
    );

    const doc = await (await request("/api/v1/openapi.json", { headers: { "x-forwarded-proto": "https" } })).json();
    assert.equal(doc.openapi, "3.1.0");
    assert.equal(doc.servers[0].url, "https://rube.test");
    for (const tool of TOOLS) assert.ok(doc.paths[`/api/v1/tools/${tool.name}`], tool.name);
  });

  test("GET and POST give the same answer as MCP", async () => {
    const viaGet = await (await request("/api/v1/tools/list_rules?enabled=true")).json();
    const viaPost = await (
      await request("/api/v1/tools/list_rules", { method: "POST", body: JSON.stringify({ enabled: true }) })
    ).json();
    const viaMcp = JSON.parse(
      (await rpc("tools/call", { name: "list_rules", arguments: { enabled: true } })).result.content[0].text,
    );
    assert.deepEqual(viaGet, viaMcp);
    assert.deepEqual(viaPost, viaMcp);
  });

  test("errors carry a status: bad arguments 400, unknown tool 404", async () => {
    assert.equal((await request("/api/v1/tools/get_rule")).status, 400);
    assert.equal((await request("/api/v1/tools/nope")).status, 404);
    assert.equal((await request("/api/v1/tools/get_job_run?runId=missing")).status, 404);
    assert.equal((await request("/api/v1/tools/get_rule_run?runId=missing")).status, 404);
    assert.equal((await request("/api/v1/tools/get_collection?ratingKey=999")).status, 404);
    assert.equal((await request("/api/v1/tools/get_rule?ruleId=missing")).status, 404);
  });

  test("query strings are coerced by the tool's schema, and a rating key stays a string", () => {
    const params = new URLSearchParams("ratingKey=101&periodDays=30&userId=7");
    assert.deepEqual(argsFromQuery(params, inputSchemaOf(TOOLS_BY_NAME.get("get_playback_history")!)), {
      ratingKey: "101",
      periodDays: 30,
      userId: 7,
    });

    const kinds = new URLSearchParams("query=x&kinds=rule,media&kinds=job&limit=5");
    assert.deepEqual(argsFromQuery(kinds, inputSchemaOf(TOOLS_BY_NAME.get("search")!)), {
      query: "x",
      kinds: ["rule", "media", "job"],
      limit: 5,
    });
  });
});
