/**
 * The Model Context Protocol, over Streamable HTTP, stateless, tools only.
 *
 * Hand-written rather than built on the SDK. What this server needs from MCP
 * is four methods — `initialize`, `ping`, `tools/list`, `tools/call` — answered
 * as plain JSON to a POST, and that is less code than adapting the SDK's
 * transport (which owns the Node request/response and its own session map) to
 * a handler that already has a parsed, authenticated request. Nothing here
 * pushes to the client, so there is no SSE stream and no `Mcp-Session-Id`:
 * every request stands alone, which is also what lets a restart go unnoticed.
 *
 * Everything below takes and returns plain objects; `index.ts` does the HTTP.
 */
import { inputSchemaOf } from "./json-schema.ts";
import { runTool } from "./run-tool.ts";
import { TOOLS, TOOLS_BY_NAME, type ToolContext } from "./tools.ts";

/**
 * Newest first. An `initialize` naming one of these gets it back; anything
 * else gets the newest, and the client decides whether it can live with that —
 * which is the negotiation the spec describes.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

const INSTRUCTIONS =
  "Tinkerbell runs rules over a Plex library to build collections, playlists, labels, overlays, metadata " +
  "changes and cleanup, on a schedule. These tools are read-only. Start with get_overview; use search to " +
  "turn a name into the id or rating key other tools take; get_rule_run and get_job_run carry logs.";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;

export function rpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isRequest(msg: unknown): msg is JsonRpcRequest {
  return (
    !!msg &&
    typeof msg === "object" &&
    (msg as JsonRpcRequest).jsonrpc === "2.0" &&
    typeof (msg as JsonRpcRequest).method === "string"
  );
}

/** One message in, one response out — or null for a notification, which gets none. */
export async function handleRpcMessage(
  msg: unknown,
  ctx: ToolContext,
  serverInfo: { version: string },
): Promise<JsonRpcResponse | null> {
  if (!isRequest(msg)) {
    const id = (msg as { id?: unknown } | null)?.id;
    return rpcError(
      typeof id === "string" || typeof id === "number" ? id : null,
      RPC_INVALID_REQUEST,
      "Not a JSON-RPC 2.0 request.",
    );
  }
  // No id means a notification (`notifications/initialized`, a cancel). There
  // is nothing in flight to cancel and no state to initialise, so each is
  // acknowledged by the transport and otherwise ignored.
  if (msg.id === undefined) return null;
  const id = msg.id;

  switch (msg.method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested as never)
        ? (requested as string)
        : SUPPORTED_PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "tinkerbell", title: "Tinkerbell", version: serverInfo.version },
          instructions: INSTRUCTIONS,
        },
      };
    }

    case "ping":
      return { jsonrpc: "2.0", id, result: {} };

    case "tools/list":
      // One page: the list is short and fixed, so the cursor is never needed.
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS.map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: inputSchemaOf(tool),
            annotations: { title: tool.title, readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          })),
        },
      };

    case "tools/call": {
      const name = msg.params?.name;
      const tool = typeof name === "string" ? TOOLS_BY_NAME.get(name) : undefined;
      if (!tool) return rpcError(id, RPC_INVALID_PARAMS, `Unknown tool: ${String(name)}`);

      // A tool that fails is a *result* the model should see and react to, not
      // a protocol error — the spec draws that line, and clients surface the
      // two very differently.
      const outcome = await runTool(tool, msg.params?.arguments, ctx);
      return {
        jsonrpc: "2.0",
        id,
        result: outcome.ok
          ? { content: [{ type: "text", text: outcome.text }], isError: false }
          : { content: [{ type: "text", text: outcome.message }], isError: true },
      };
    }

    default:
      return rpcError(id, RPC_METHOD_NOT_FOUND, `Method not supported: ${msg.method}`);
  }
}
