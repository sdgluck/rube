import type { SmartFilterGroup, SmartFilterNode, SmartFilterOp } from "./parse.ts";

/**
 * Plex operator suffix for each smart_filter op. `>>=`/`<<=` are Plex's
 * bracketed gte/lte syntax; `==` is exact-match (vs `=` substring).
 * Emitted literally so Plex's URL parser sees the operator straight up
 * — round-trips with `parseSmartFilterUri`.
 */
const OP_SUFFIX: Record<SmartFilterOp, string> = {
  "=": "=",
  "==": "==",
  "!=": "!=",
  ">=": ">>=",
  "<=": "<<=",
};

/**
 * Walk the boolean tree and produce Plex-style URL fragments. AND
 * groups list children flatly (Plex's default joiner is AND); OR groups
 * wrap children in `push=1 ... or=1 ... pop=1` with `or=1` between
 * siblings. Nested groups recurse, so arbitrary AND/OR trees survive
 * round-tripping through `parseSmartFilterUri` → `emitSmartFilterTree`.
 */
export function emitSmartFilterTree(filter: SmartFilterGroup): string[] {
  return emitNode(filter);
}

function emitNode(node: SmartFilterNode): string[] {
  if (node.kind === "leaf") {
    const suffix = OP_SUFFIX[node.op];
    return [`${encodeURIComponent(node.field)}${suffix}${encodeURIComponent(node.value)}`];
  }
  if (node.combinator === "all") {
    return node.children.flatMap(emitNode);
  }
  const parts: string[] = ["push=1"];
  node.children.forEach((c, i) => {
    if (i > 0) parts.push("or=1");
    parts.push(...emitNode(c));
  });
  parts.push("pop=1");
  return parts;
}
