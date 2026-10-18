/**
 * `pnpm native:codegen` — write the Swift and Kotlin models — and
 * `pnpm native:codegen --check`, which `pnpm verify` runs: regenerate in memory
 * and fail if what is committed differs.
 *
 * Builds the real routers from a throwaway container to read each procedure's
 * `.input()`. That costs a temp database, and is the only way to see the
 * inputs as tRPC actually validates them rather than a copy.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { z } from "zod";
import { NATIVE_PROCEDURES, type NativeRouter } from "@tinkerbell/contracts/native-api";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { JobsToken, registerJobs } from "@tinkerbell/jobs";
import { createTrpc } from "@tinkerbell/trpc";
import { emitKotlin, emitSwift, type ProcedureSource } from "./collect.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");

export const TARGETS = {
  swift: join(ROOT, "native/ios/Packages/TinkerbellKit/Sources/TinkerbellModels/Generated/API.swift"),
  kotlin: join(ROOT, "native/android/core/model/src/main/kotlin/dev/tinkerbell/model/generated/Api.kt"),
};

interface Def {
  type: "query" | "mutation" | "subscription";
  inputs: z.ZodType[];
}

async function sources(): Promise<ProcedureSource[]> {
  const c = createTestContainer({ overrides: registerJobs });
  try {
    const { appRouter, portalRouter } = createTrpc({ ...c.resolve(ServicesToken), jobs: c.resolve(JobsToken) });
    const routers = { admin: appRouter, portal: portalRouter } as const;
    const out: ProcedureSource[] = [];
    // Portal first: it is the part every user gets, and the order is the file's.
    for (const router of ["portal", "admin"] as NativeRouter[]) {
      const procedures = (routers[router] as unknown as { _def: { procedures: Record<string, { _def: Def }> } })._def
        .procedures;
      for (const [path, output] of Object.entries(NATIVE_PROCEDURES[router])) {
        const def = procedures[path]?._def;
        if (!def) throw new Error(`${router} ${path} is in NATIVE_PROCEDURES but not on the router`);
        if (def.type === "subscription") throw new Error(`${router} ${path}: subscriptions aren't supported`);
        if (def.inputs.length > 1) throw new Error(`${router} ${path}: chained .input()s aren't supported`);
        out.push({ router, path, kind: def.type, input: def.inputs[0], output: (output as z.ZodType | null) ?? null });
      }
    }
    return out;
  } finally {
    await c.dispose();
  }
}

export async function generate(): Promise<Record<keyof typeof TARGETS, string>> {
  const all = await sources();
  return { swift: emitSwift(all), kotlin: emitKotlin(all) };
}

async function main() {
  const check = process.argv.includes("--check");
  const files = await generate();
  const stale: string[] = [];
  for (const [kind, path] of Object.entries(TARGETS) as Array<[keyof typeof TARGETS, string]>) {
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {
      // Missing counts as stale.
    }
    if (current === files[kind]) continue;
    if (check) stale.push(relative(ROOT, path));
    else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, files[kind]);
      console.log(`wrote ${relative(ROOT, path)}`);
    }
  }
  if (stale.length) {
    console.error(`native models are stale — run \`pnpm native:codegen\`:\n  ${stale.join("\n  ")}`);
    process.exit(1);
  }
  if (!check) console.log("native models up to date");
}

if (import.meta.main) await main();
