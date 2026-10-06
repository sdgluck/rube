/**
 * Tool inputs as JSON Schema — what MCP's `inputSchema` and OpenAPI both want.
 *
 * Generated in `input` mode, so a field with a zod default is optional in the
 * schema: the caller may omit it, which is the truth about the input even
 * though the parsed value always has it.
 */
import { z } from "zod";
import type { AgentTool } from "./tools.ts";

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
  [key: string]: unknown;
}

const cache = new WeakMap<AgentTool, JsonSchema>();

export function inputSchemaOf(tool: AgentTool): JsonSchema {
  let schema = cache.get(tool);
  if (!schema) {
    const { $schema: _, ...rest } = z.toJSONSchema(tool.input, { io: "input", unrepresentable: "any" }) as JsonSchema;
    schema = rest;
    cache.set(tool, schema);
  }
  return schema;
}
