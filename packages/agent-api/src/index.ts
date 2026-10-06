/**
 * The agent API: `/mcp` and `/api/v1`, on the admin server.
 *
 * Written against the Fetch API's `Request`/`Response` rather than Node's
 * `IncomingMessage`, so the whole surface — auth, routing, both transports —
 * is testable by constructing a `Request`, with no port opened.
 *
 * Authentication is an API key, always, whatever the admin-auth setting says
 * (see `domains/api-keys`). Accepted as `Authorization: Bearer` — what MCP
 * clients send — or `X-Api-Key`, which is what anybody who has configured an
 * *Arr will reach for. Never in the query string, where it would end up in
 * every proxy's access log.
 *
 * No cookie is read, so a browser cannot be made to call this with somebody
 * else's credentials; that, rather than an Origin check, is the DNS-rebinding
 * defence the MCP spec asks for.
 */
import type { Scope } from "@tinkerbell/container";
import { createLogger } from "@tinkerbell/core";
import type { ApiKeyIdentity } from "@tinkerbell/domain.api-keys";
import type { AdminContext, Trpc } from "@tinkerbell/trpc";
import { handleRpcMessage, rpcError, RPC_PARSE_ERROR, type JsonRpcResponse } from "./mcp.ts";
import { argsFromQuery, openApiDocument } from "./rest.ts";
import { inputSchemaOf } from "./json-schema.ts";
import { runTool } from "./run-tool.ts";
import { TOOLS, TOOLS_BY_NAME, type ToolContext } from "./tools.ts";

export { TOOLS } from "./tools.ts";
export { SUPPORTED_PROTOCOL_VERSIONS } from "./mcp.ts";

const log = createLogger("agent-api");

export const MCP_PATH = "/mcp";
export const REST_PREFIX = "/api/v1";

/** Requests are a JSON-RPC envelope or a handful of tool arguments. */
const MAX_BODY_BYTES = 1024 * 1024;

export interface AgentApiDeps {
  createCaller: Trpc["createCaller"];
  verifyApiKey: (raw: string | undefined) => ApiKeyIdentity | undefined;
  /** The root scope; each request gets a child, disposed when it is answered. */
  scope: Scope;
  version: string;
}

/** True for every path this module answers, so the server can route here first. */
export function isAgentApiPath(path: string): boolean {
  return path === MCP_PATH || path === REST_PREFIX || path.startsWith(`${REST_PREFIX}/`);
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function presentedKey(req: Request): string | undefined {
  const auth = req.headers.get("authorization");
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || req.headers.get("x-api-key")?.trim() || undefined;
}

/** Where the caller reached us, behind a proxy or not — for the OpenAPI `servers` entry. */
function originOf(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

async function readBody(req: Request): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return { ok: false, message: "Request body too large." };
  if (text.trim() === "") return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, message: "Request body isn't valid JSON." };
  }
}

export function createAgentApi(deps: AgentApiDeps) {
  const { createCaller, verifyApiKey, scope: rootScope, version } = deps;

  function contextFor(key: ApiKeyIdentity, req: Request, scope: Scope): ToolContext {
    const ctx: AdminContext = {
      scope,
      apiKey: key,
      resHeaders: new Headers(),
      secure: originOf(req).startsWith("https:"),
      origin: originOf(req),
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
      // Required, so nothing below can mistake an agent for an anonymous
      // caller on an instance with auth off; the key is what admits it.
      authRequired: true,
    };
    return { caller: createCaller(ctx), version };
  }

  async function handleMcp(req: Request, ctx: ToolContext, keyName: string): Promise<Response> {
    if (req.method !== "POST") {
      // No server-initiated stream and no sessions to delete. 405 is how the
      // Streamable HTTP transport says so.
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }
    const body = await readBody(req);
    if (!body.ok) return json(400, rpcError(null, RPC_PARSE_ERROR, body.message));

    const messages = Array.isArray(body.value) ? body.value : [body.value];
    const responses: JsonRpcResponse[] = [];
    for (const msg of messages) {
      const started = performance.now();
      const res = await handleRpcMessage(msg, ctx, { version });
      if (res) responses.push(res);
      const m = msg as { method?: string; params?: { name?: string } };
      if (m?.method === "tools/call") {
        log.info("mcp tool call", { key: keyName, tool: m.params?.name, ms: Math.round(performance.now() - started) });
      }
    }
    // Notifications only: accepted, nothing to say.
    if (responses.length === 0) return new Response(null, { status: 202 });
    return json(200, Array.isArray(body.value) ? responses : responses[0]);
  }

  async function handleRest(req: Request, ctx: ToolContext, path: string, keyName: string): Promise<Response> {
    if (path === REST_PREFIX || path === `${REST_PREFIX}/`) {
      return json(200, {
        name: "tinkerbell",
        version,
        readOnly: true,
        mcp: MCP_PATH,
        openapi: `${REST_PREFIX}/openapi.json`,
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          path: `${REST_PREFIX}/tools/${tool.name}`,
          input: inputSchemaOf(tool),
        })),
      });
    }
    if (path === `${REST_PREFIX}/openapi.json`) {
      return json(200, openApiDocument({ origin: originOf(req), version }));
    }

    const name = path.match(/^\/api\/v1\/tools\/([a-z_]+)$/)?.[1];
    const tool = name ? TOOLS_BY_NAME.get(name) : undefined;
    if (!tool) return json(404, { error: `No such endpoint. See ${REST_PREFIX} for the list.` });
    if (req.method !== "GET" && req.method !== "POST") {
      return json(405, { error: "Use GET or POST." }, { Allow: "GET, POST" });
    }

    let args: unknown;
    if (req.method === "GET") {
      args = argsFromQuery(new URL(req.url).searchParams, inputSchemaOf(tool));
    } else {
      const body = await readBody(req);
      if (!body.ok) return json(400, { error: body.message });
      args = body.value;
    }

    const started = performance.now();
    const outcome = await runTool(tool, args, ctx);
    log.info("rest tool call", { key: keyName, tool: tool.name, ms: Math.round(performance.now() - started) });
    if (!outcome.ok) return json(outcome.status, { error: outcome.message });
    return new Response(outcome.text, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...(outcome.truncated ? { "X-Tinkerbell-Truncated": "true" } : {}),
      },
    });
  }

  /** Answer a request for an agent API path. Call only when `isAgentApiPath` holds. */
  async function handleAgentRequest(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    const key = verifyApiKey(presentedKey(req));
    if (!key) {
      return json(
        401,
        { error: "An API key is required. Create one in Tinkerbell under Settings → API & MCP." },
        { "WWW-Authenticate": 'Bearer realm="tinkerbell"' },
      );
    }

    const scope = rootScope.createScope("agent-request");
    try {
      const ctx = contextFor(key, req, scope);
      return path === MCP_PATH ? await handleMcp(req, ctx, key.name) : await handleRest(req, ctx, path, key.name);
    } finally {
      await scope.dispose();
    }
  }

  return { handleAgentRequest };
}

export type AgentApi = ReturnType<typeof createAgentApi>;
