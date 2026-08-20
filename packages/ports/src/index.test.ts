/**
 * This package had a `test` script and no tests, so `node --test` exited 0 on
 * an empty glob and the suite reported a green that meant nothing. What it
 * should assert is the two rules the file's own header states and nothing
 * enforces:
 *
 * 1. Every token is a distinct key. `token()` mints a fresh `Symbol` per call,
 *    so two tokens sharing a description are still distinct — which means a
 *    copy-pasted `token<Foo>("health.reporter")` would resolve to a *different*
 *    registration than the one every consumer names, and nothing would say so.
 *    Duplicate descriptions are therefore the smell, not the bug, and this
 *    fails on them.
 * 2. "No runtime imports, and no dependencies beyond the container." A single
 *    runtime import of a sibling workspace package here would put half the
 *    workspace behind the wave-0 packages that depend on this one, and the
 *    failure would show up as an import cycle somewhere else entirely.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import type { AnyToken } from "@tinkerbell/container";
import * as ports from "./index.ts";

const SOURCE = join(import.meta.dirname, "index.ts");

function tokens(): [string, AnyToken][] {
  return Object.entries(ports).filter((entry): entry is [string, AnyToken] => {
    const value = entry[1];
    return typeof value === "object" && value !== null && "key" in value && "description" in value;
  });
}

describe("the port tokens", () => {
  test("there are some — this test is worthless if the export list empties", () => {
    assert.ok(tokens().length >= 8, `expected the ports to be exported, saw ${tokens().length}`);
  });

  test("every token is a distinct key", () => {
    const keys = new Set(tokens().map(([, t]) => t.key));
    assert.equal(keys.size, tokens().length);
  });

  test("no two tokens share a description", () => {
    const seen = new Map<string, string>();
    for (const [name, t] of tokens()) {
      const previous = seen.get(t.description);
      assert.equal(
        previous,
        undefined,
        `${name} and ${previous} both describe themselves as "${t.description}" — ` +
          `they are still distinct keys, so one of them resolves to nothing`,
      );
      seen.set(t.description, name);
    }
  });

  test("every token is described, and namespaced", () => {
    // The description is the only thing that appears in a resolution path, so
    // a blank or bare one makes a failing resolve unreadable. The `area.thing`
    // shape is what every existing token uses.
    for (const [name, t] of tokens()) {
      assert.match(t.description, /^[a-z][a-zA-Z]*\.[a-zA-Z]+$/, `${name} is described as "${t.description}"`);
    }
  });
});

describe("the scope rule", () => {
  test("imports nothing at runtime but the container", () => {
    const source = readFileSync(SOURCE, "utf8");
    // Type-only imports are erased, so they cannot create a cycle and are
    // allowed; a value import is what this is looking for.
    const runtimeImports = [...source.matchAll(/^import\s+(?!type\s)[^;]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
    assert.deepEqual(runtimeImports, ["@tinkerbell/container"]);
  });

  test("declares no dependency but the container", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    assert.deepEqual(Object.keys(pkg.dependencies ?? {}), ["@tinkerbell/container"]);
  });
});
