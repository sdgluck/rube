/**
 * Calling one tool, the same way for both transports.
 *
 * MCP and REST disagree about how a failure is spelt — a tool result with
 * `isError` against an HTTP status — but not about what counts as one, so the
 * validation, the error mapping and the size cap all live here and each
 * transport only translates the outcome.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { AgentTool, ToolContext } from "./tools.ts";

/**
 * A ceiling on one answer, in characters of JSON.
 *
 * Every tool paginates or caps what it returns, so this is a backstop rather
 * than a design: a 300-collection library with long summaries could still
 * produce an answer that fills an agent's whole context, and a truncated
 * answer that says so is more use than one the client drops.
 */
export const MAX_RESULT_CHARS = 200_000;

export type ToolOutcome =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; status: number; message: string };

const STATUS_BY_CODE: Partial<Record<TRPCError["code"], number>> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  TOO_MANY_REQUESTS: 429,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
};

export async function runTool(tool: AgentTool, args: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) {
    return { ok: false, status: 400, message: `Invalid arguments for ${tool.name}:\n${z.prettifyError(parsed.error)}` };
  }

  try {
    const value = await tool.run(parsed.data as never, ctx);
    const text = JSON.stringify(value ?? null);
    if (text.length <= MAX_RESULT_CHARS) return { ok: true, text, truncated: false };
    return {
      ok: true,
      text:
        text.slice(0, MAX_RESULT_CHARS) +
        `\n…[truncated: the answer was ${text.length} characters. Narrow it with the tool's filters or a smaller limit.]`,
      truncated: true,
    };
  } catch (err) {
    if (err instanceof TRPCError) {
      return { ok: false, status: STATUS_BY_CODE[err.code] ?? 500, message: err.message };
    }
    return { ok: false, status: 500, message: err instanceof Error ? err.message : String(err) };
  }
}
