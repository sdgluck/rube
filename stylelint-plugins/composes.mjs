/**
 * Which shared primitives a CSS-module class is built from, following
 * `composes:` through local classes and through other page modules until it
 * reaches styles/controls.module.css or styles/shared.module.css.
 *
 * The rules that use this ask "is `.saveBtn` a button?" and "is `.planTable` a
 * table?", and the honest answer is often two hops away — `.actionBtnOverflow`
 * composes `.actionBtnSecondary`, which composes `btn`; Settings pages compose
 * classes from Settings.module.css that compose the primitive. Looking only at
 * the rule's own `composes:` line would call all of those bespoke.
 */

import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export const STYLES_DIR = "apps/web/src/styles";

/** file → Map<class, { local: string[], external: { file, names }[] }> */
const cache = new Map();

/**
 * A stylesheet we only need the `composes:` edges of. A regex over top-level
 * `.name { … }` blocks is enough for that, and keeps this plugin free of a
 * direct postcss dependency (stylelint's own copy isn't resolvable from here).
 */
function parseFile(file) {
  if (cache.has(file)) return cache.get(file);
  let source = "";
  try {
    source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  } catch {
    /* A missing module is the bundler's error to report, not this rule's. */
  }
  const classes = new Map();
  for (const [, selectors, body] of source.matchAll(/^(\.[A-Za-z][\w-]*(?:\s*,\s*\.[A-Za-z][\w-]*)*)\s*\{([^}]*)\}/gm)) {
    for (const [, value] of body.matchAll(/composes:\s*([^;]+);/g)) {
      for (const name of selectors.split(",")) addEdge(classes, file, name.trim().slice(1), value);
    }
  }
  cache.set(file, classes);
  return classes;
}

/** `#/styles/x.module.css` is the web app's subpath alias for its src/. */
function resolvePath(from, spec) {
  if (!spec.startsWith("#/")) return resolve(dirname(from), spec);
  const src = from.slice(0, from.indexOf("/apps/web/src/") + "/apps/web/src/".length);
  return resolve(src, spec.slice(2));
}

function addEdge(classes, file, name, value) {
  const entry = classes.get(name) ?? { local: [], external: [] };
  const m = value.trim().match(/^(.*?)\s+from\s+["'](.+)["']$/);
  if (!m) entry.local.push(...value.trim().split(/\s+/).filter(Boolean));
  else if (m[2] !== "global") entry.external.push({ file: resolvePath(file, m[2]), names: m[1].split(/\s+/) });
  classes.set(name, entry);
}

/** Index the stylesheet being linted from its live AST. */
export function collect(file, root) {
  const classes = new Map();
  root.walkRules((rule) => {
    /* `.cancelBtn, .secondaryBtn { composes: … }` gives both names the edge. */
    for (const selector of rule.selectors) {
      const name = selector.trim().match(/^\.([A-Za-z][\w-]*)$/)?.[1];
      if (!name) continue;
      rule.each((node) => {
        if (node.type === "decl" && node.prop === "composes") addEdge(classes, file, name, node.value);
      });
    }
  });
  return classes;
}

/**
 * Every primitive `className` in `file` resolves to, as "controls.module.css:btn"
 * style keys. A class in a primitive stylesheet is itself a primitive (and also
 * resolves through whatever it composes — shared `.button` is `btn btnPrimary`).
 */
export function primitivesOf(file, className, index = parseFile(file), seen = new Set()) {
  const key = `${file}:${className}`;
  const out = new Set();
  if (seen.has(key)) return out;
  seen.add(key);

  const inStyles = file.includes(`/${STYLES_DIR}/`);
  if (inStyles) out.add(`${basename(file)}:${className}`);

  const entry = index.get(className);
  if (!entry) return out;
  for (const local of entry.local) for (const p of primitivesOf(file, local, index, seen)) out.add(p);
  for (const { file: other, names } of entry.external) {
    const otherIndex = parseFile(other);
    for (const n of names) for (const p of primitivesOf(other, n, otherIndex, seen)) out.add(p);
  }
  return out;
}

/** The last compound of a selector — the element the declarations land on. */
export function subjectOf(selector) {
  const parts = selector
    .replace(/::?[\w-]+(\([^)]*\))?/g, "")
    .trim()
    .split(/\s*[>+~]\s*|\s+/);
  const last = parts[parts.length - 1] ?? "";
  return {
    classes: [...last.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]),
    element: last.match(/^([a-z][a-z0-9]*)/)?.[1],
    ancestors: parts.slice(0, -1).flatMap((p) => [...p.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1])),
  };
}
