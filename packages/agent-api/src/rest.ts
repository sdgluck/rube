/**
 * The same tools as plain HTTP, for scripts and agents that don't speak MCP.
 *
 * One route per tool — `/api/v1/tools/<name>` — rather than a resource-shaped
 * REST API, because a second, differently-shaped surface over the same data is
 * a second thing to keep correct. GET takes query parameters and POST a JSON
 * body; both are accepted on every tool because they are all reads, and a GET
 * is what `curl` and a browser address bar can make.
 */
import { inputSchemaOf, type JsonSchema } from "./json-schema.ts";
import { TOOLS } from "./tools.ts";

/**
 * A query string is all strings; the tool's schema says what each one was
 * meant to be. Arrays may be repeated (`?kinds=rule&kinds=media`) or
 * comma-separated (`?kinds=rule,media`).
 */
export function argsFromQuery(params: URLSearchParams, schema: JsonSchema): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const key of new Set(params.keys())) {
    const prop = schema.properties?.[key];
    const values = params.getAll(key);
    if (prop?.type === "array") {
      args[key] = values
        .flatMap((v) => v.split(","))
        .filter((v) => v !== "")
        .map((v) => coerce(v, prop.items));
    } else {
      args[key] = coerce(values[values.length - 1]!, prop);
    }
  }
  return args;
}

function coerce(value: string, prop: JsonSchema | undefined): unknown {
  // A rating key is digits but a string, and must stay one.
  if (prop?.type === "string") return value;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === "true" || value === "false") return value === "true";
  return value;
}

export function openApiDocument(opts: { origin: string; version: string }): unknown {
  const paths: Record<string, unknown> = {};
  for (const tool of TOOLS) {
    const schema = inputSchemaOf(tool);
    const required = new Set(schema.required ?? []);
    const responses = {
      "200": { description: "The tool's answer.", content: { "application/json": { schema: {} } } },
      "400": { description: "The arguments didn't validate." },
      "401": { description: "Missing or unknown API key." },
      "404": { description: "No such thing." },
      "412": { description: "An integration this tool needs (usually Plex) isn't configured." },
    };
    paths[`/api/v1/tools/${tool.name}`] = {
      get: {
        operationId: tool.name,
        summary: tool.title,
        description: tool.description,
        parameters: Object.entries(schema.properties ?? {}).map(([name, prop]) => ({
          name,
          in: "query",
          required: required.has(name),
          description: prop.description,
          schema: prop,
          ...(prop.type === "array" ? { style: "form", explode: false } : {}),
        })),
        responses,
      },
      post: {
        operationId: `${tool.name}_post`,
        summary: tool.title,
        description: tool.description,
        requestBody: { required: false, content: { "application/json": { schema } } },
        responses,
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Tinkerbell agent API",
      version: opts.version,
      description:
        "Read-only access to a Tinkerbell instance. The same tools are served over MCP at /mcp. " +
        "Authenticate with `Authorization: Bearer <key>`; create keys in Settings → API & MCP.",
    },
    servers: [{ url: opts.origin }],
    security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
    paths,
  };
}
