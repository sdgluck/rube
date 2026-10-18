/**
 * The manifest and the routers' inputs, as one IR document.
 *
 * Outputs come from `NATIVE_PROCEDURES` (the same objects the routers attach
 * with `.output()`); inputs come from each procedure's own `.input()`, read off
 * the router, because those already exist and duplicating them into contracts
 * would be a second copy free to drift from the one tRPC validates.
 *
 * Pure over its arguments — the CLI is what builds a container to get routers —
 * so the tests drive it with plain zod schemas.
 */
import { z } from "zod";
import { fromJsonSchema, SchemaError, type IRDocument, type IRProcedure, type IRType } from "./ir.ts";

export interface ProcedureSource {
  router: "portal" | "admin";
  path: string;
  kind: "query" | "mutation";
  input: z.ZodType | undefined;
  output: z.ZodType | null;
}

export function buildDocument(sources: ProcedureSource[]): IRDocument {
  const defs = new Map<string, { t: IRType; from: string }>();
  const procedures: IRProcedure[] = [];

  function take(schema: z.ZodType, io: "input" | "output", where: string): IRType {
    const json = z.toJSONSchema(schema, { io, reused: "ref", unrepresentable: "throw", target: "draft-2020-12" });
    const converted = fromJsonSchema(json as Record<string, unknown>, where);
    for (const [name, t] of converted.defs) {
      const seen = defs.get(name);
      if (!seen) defs.set(name, { t, from: where });
      else if (JSON.stringify(seen.t) !== JSON.stringify(t)) {
        // The same id meaning two shapes — usually one def read as input in one
        // place and output in another, where a default makes them differ.
        throw new SchemaError(`${name} is defined differently by ${seen.from} and ${where}`);
      }
    }
    return converted.t;
  }

  for (const s of sources) {
    const where = `${s.router} ${s.path}`;
    procedures.push({
      router: s.router,
      path: s.path,
      kind: s.kind,
      input: s.input ? take(s.input, "input", `${where} (input)`) : null,
      output: s.output ? take(s.output, "output", `${where} (output)`) : null,
    });
  }

  return {
    procedures,
    defs: [...defs].map(([name, { t }]) => ({ name, t })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
