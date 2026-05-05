/**
 * smart_filter rule config — recursive boolean tree mirroring Plex's own
 * filter expressiveness. Leaves are field/op/value triples; groups
 * combine children with AND (`all`) or OR (`any`), and groups can nest
 * arbitrarily. Round-trips through `parseSmartFilterUri` and the runtime
 * emitter without losing fidelity, so any Plex smart collection that
 * uses these shapes (including OR-within-field via repeated equality
 * clauses, and OR groups via push/or/pop blocks) survives migration.
 */
export type SmartFilterOp = "=" | "==" | "!=" | ">=" | "<=";

export interface SmartFilterLeaf {
  kind: "leaf";
  field: string;
  /**
   * `=` is Plex's "contains" (case-insensitive substring) for string
   * fields; `==` is exact match. The Plex UI emits `field%3D=value` —
   * note the URL-encoded extra `=` — for exact match. Keep both ops
   * distinct so round-trip preserves user intent.
   */
  op: SmartFilterOp;
  value: string;
}

export interface SmartFilterGroup {
  kind: "group";
  combinator: "all" | "any";
  children: SmartFilterNode[];
}

export type SmartFilterNode = SmartFilterLeaf | SmartFilterGroup;

export interface ParseResult {
  /** Root node — always a group, even when there's only one leaf. */
  filter: SmartFilterGroup;
  /**
   * Tokens we couldn't translate (strict gt/lt with no `=`, OR-pipe
   * values, malformed segments). Surface in the provider's `unmappable`
   * list when non-empty so the user sees what was skipped instead of a
   * silently-lossy migration.
   */
  unsupported: string[];
}

/**
 * Pure shape-control fields with no semantic content — strip silently.
 * `type=N` (section type), `sort=…`, pagination, and the various
 * `includeFoo` flags fall here. `and=1` lives here too: Plex's UI
 * annotates AND'd clauses with explicit `and=1` separators, but since
 * AND is the default joiner inside any group, the marker is a no-op
 * (NOT a group introducer). Group structure comes from `push`/`pop`
 * with `or=1` between siblings.
 */
const SHAPE_FIELDS = new Set(["type", "sort", "limit", "includeGuids", "includeCollections", "includeAdvanced", "and"]);

const X_PLEX_PREFIX = "X-Plex-";

/**
 * Operator suffixes Plex emits on its filter URIs. The longer suffixes
 * MUST be tried first (`>>=` before `>>`, `==` before `=`) — naïve `=`
 * matching would split the wrong way and drop the operator entirely.
 */
const OP_SUFFIXES: Array<{ suffix: string; op: SmartFilterOp | null }> = [
  { suffix: ">>=", op: ">=" },
  { suffix: "<<=", op: "<=" },
  { suffix: ">>", op: null }, // strict gt — not modelled by smart_filter ops yet
  { suffix: "<<", op: null }, // strict lt — same
  { suffix: "!=", op: "!=" },
  { suffix: "==", op: "==" },
  { suffix: "=", op: "=" },
];

interface MatchedSegment {
  field: string;
  op: SmartFilterOp | null;
  value: string;
  suffix: string;
}

function matchOperator(raw: string): MatchedSegment | null {
  for (const { suffix, op } of OP_SUFFIXES) {
    const idx = raw.indexOf(suffix);
    if (idx < 0) continue;
    return { field: raw.slice(0, idx), op, value: raw.slice(idx + suffix.length), suffix };
  }
  return null;
}

type Token =
  | { kind: "leaf"; leaf: SmartFilterLeaf }
  | { kind: "push" }
  | { kind: "pop" }
  | { kind: "or" }
  | { kind: "skip" }
  | { kind: "unsupported"; raw: string };

function tokenize(query: string, unsupported: string[]): Token[] {
  const tokens: Token[] = [];
  for (const rawSegment of query.split("&")) {
    if (!rawSegment) continue;

    // Decode the whole segment BEFORE matching operator suffixes — Plex
    // emits operators URL-encoded (`>>=` → `%3E%3E=`, `==` → `%3D=`),
    // and matching against the encoded form would only ever hit the
    // trailing literal `=`. Decoding first exposes the real operator.
    const raw = decodeURIComponent(rawSegment);

    const matched = matchOperator(raw);
    if (!matched) {
      tokens.push({ kind: "unsupported", raw });
      continue;
    }

    const { field, value, op, suffix } = matched;
    if (!field) {
      tokens.push({ kind: "unsupported", raw });
      continue;
    }
    if (SHAPE_FIELDS.has(field)) {
      tokens.push({ kind: "skip" });
      continue;
    }
    if (field.startsWith(X_PLEX_PREFIX)) {
      tokens.push({ kind: "skip" });
      continue;
    }

    // Structural markers. `or=1` flips the enclosing group to `any`;
    // `push=1`/`pop=1` open and close subgroups. `group=…` is Plex's
    // legacy advanced grouping — surface as unsupported since we don't
    // model its semantics.
    if (field === "push") {
      tokens.push({ kind: "push" });
      continue;
    }
    if (field === "pop") {
      tokens.push({ kind: "pop" });
      continue;
    }
    if (field === "or") {
      tokens.push({ kind: "or" });
      continue;
    }
    if (field === "group") {
      unsupported.push(`${field}=${value} (advanced group)`);
      continue;
    }

    if (op === null) {
      unsupported.push(`${field} (strict ${suffix === ">>" ? "gt" : "lt"})`);
      continue;
    }

    if (!value) {
      unsupported.push(raw);
      continue;
    }

    // Pipe-separated values are Plex's "OR within field" shorthand
    // (`genre=Action|Comedy`). Expand into an `any` group of leaves so
    // it round-trips alongside the explicit push/or/pop form.
    if (value.includes("|")) {
      const parts = value.split("|").filter(Boolean);
      if (parts.length === 0) {
        unsupported.push(raw);
        continue;
      }
      tokens.push({ kind: "push" });
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) tokens.push({ kind: "or" });
        tokens.push({ kind: "leaf", leaf: { kind: "leaf", field, op, value: parts[i] } });
      }
      tokens.push({ kind: "pop" });
      continue;
    }

    tokens.push({ kind: "leaf", leaf: { kind: "leaf", field, op, value } });
  }

  for (const t of tokens) {
    if (t.kind === "unsupported") unsupported.push(t.raw);
  }
  return tokens;
}

interface PendingGroup {
  combinator: "all" | "any";
  children: SmartFilterNode[];
}

function build(tokens: Token[]): SmartFilterGroup {
  const stack: PendingGroup[] = [{ combinator: "all", children: [] }];
  for (const token of tokens) {
    const top = stack[stack.length - 1];
    switch (token.kind) {
      case "leaf":
        top.children.push(token.leaf);
        break;
      case "push":
        stack.push({ combinator: "all", children: [] });
        break;
      case "or":
        // Any `or=1` between siblings means the enclosing group is OR.
        // Plex doesn't mix AND/OR within a single group — nested groups
        // model that — so a single switch on first `or` is sufficient.
        top.combinator = "any";
        break;
      case "pop": {
        if (stack.length <= 1) break; // unmatched pop — ignore defensively
        const closed = stack.pop()!;
        const parent = stack[stack.length - 1];
        parent.children.push({ kind: "group", combinator: closed.combinator, children: closed.children });
        break;
      }
      case "skip":
      case "unsupported":
        break;
    }
  }
  // Unmatched pushes (malformed Plex output) — close them off so we
  // still produce a tree rather than dropping their children silently.
  while (stack.length > 1) {
    const closed = stack.pop()!;
    const parent = stack[stack.length - 1];
    parent.children.push({ kind: "group", combinator: closed.combinator, children: closed.children });
  }
  const root: SmartFilterGroup = { kind: "group", combinator: stack[0].combinator, children: stack[0].children };
  // Fold first (may introduce single-child groups), then simplify so
  // the freshly-introduced wrappers collapse where they're redundant.
  return simplifyGroup(foldRepeatedEquality(simplifyGroup(root)));
}

/**
 * Within each `all` group, fold repeated `=` clauses on the same field
 * into an implicit `any` subgroup — Plex's IN semantics
 * (`genre=A&genre=B` matches "A OR B"). AND'ing them would produce a
 * contradiction (no item has two genres in the same slot). Repeated
 * clauses with mixed operators (`year>>=1990&year<<=1999`) are a real
 * AND range and stay flat.
 *
 * Within an `any` group there's nothing to fold — repeated leaves there
 * already mean OR.
 */
function foldRepeatedEquality(group: SmartFilterGroup): SmartFilterGroup {
  const folded: SmartFilterNode[] = group.children.map((c) => (c.kind === "group" ? foldRepeatedEquality(c) : c));

  if (group.combinator !== "all") return { ...group, children: folded };

  // Group leaves by field; only fold when the field has 2+ `=` leaves.
  const byField = new Map<string, SmartFilterLeaf[]>();
  for (const c of folded) {
    if (c.kind === "leaf" && c.op === "=") {
      const arr = byField.get(c.field) ?? [];
      arr.push(c);
      byField.set(c.field, arr);
    }
  }
  const foldable = new Set<string>();
  for (const [field, leaves] of byField) {
    if (leaves.length >= 2) foldable.add(field);
  }
  if (foldable.size === 0) return { ...group, children: folded };

  const result: SmartFilterNode[] = [];
  const placed = new Set<string>(); // fields whose `any` group we've already inserted
  for (const c of folded) {
    if (c.kind === "leaf" && c.op === "=" && foldable.has(c.field)) {
      if (placed.has(c.field)) continue;
      placed.add(c.field);
      const leaves = byField.get(c.field)!;
      result.push({ kind: "group", combinator: "any", children: leaves });
    } else {
      result.push(c);
    }
  }
  return { ...group, children: result };
}

/**
 * Drop empty subgroups, flatten same-combinator nesting (associativity:
 * `(a AND (b AND c))` → `(a AND b AND c)`), and unwrap single-child
 * groups (a group with one child carries no information beyond the
 * child itself). The root is always returned as a group: if simplifying
 * leaves us with a single leaf at the root, we re-wrap it in an `all`
 * group since emitter, UI, and importer all expect a group at the top.
 */
function simplifyGroup(group: SmartFilterGroup): SmartFilterGroup {
  const children: SmartFilterNode[] = [];
  for (const c of group.children) {
    if (c.kind === "leaf") {
      children.push(c);
      continue;
    }
    const sub = simplifyGroup(c);
    if (sub.children.length === 0) continue;
    // Single-child subgroup — the combinator is meaningless, splice the
    // child up directly (whether leaf or group).
    if (sub.children.length === 1) {
      children.push(sub.children[0]);
      continue;
    }
    // Same-combinator nesting flattens by associativity. Plex doesn't
    // emit this but we generate it during equality folding when an
    // existing `any` group sits beside fold-folded leaves.
    if (sub.combinator === group.combinator) {
      children.push(...sub.children);
      continue;
    }
    children.push(sub);
  }
  // Root-level unwrap: a single-child root inherits the child's shape
  // so the user-facing tree doesn't carry a redundant outer group. If
  // the only child is a leaf we keep it wrapped (root invariant).
  if (children.length === 1 && children[0].kind === "group") {
    return children[0];
  }
  return { kind: "group", combinator: group.combinator, children };
}

/**
 * Parse a Plex smart-collection content URI into a recursive boolean
 * tree. Plex stores the filter as `/library/sections/N/all?…` with a
 * mix of `key=value` clauses, operator suffixes (`>>=`, `<<=`, `==`,
 * `!=`), and structural markers (`push=1` / `pop=1` for grouping,
 * `or=1` for OR'd siblings). We tokenize, then build a tree by walking
 * the tokens with a stack — push opens a new subgroup, pop closes it,
 * `or=1` flips the enclosing group's combinator. Repeated `=` clauses
 * on the same field within an AND group are folded into an implicit OR
 * subgroup so explicit and implicit OR converge to the same shape.
 */
export function parseSmartFilterUri(uri: string): ParseResult {
  const unsupported: string[] = [];
  const queryStart = uri.indexOf("?");
  if (queryStart < 0) return { filter: { kind: "group", combinator: "all", children: [] }, unsupported };
  const query = uri.slice(queryStart + 1);
  const tokens = tokenize(query, unsupported);
  const filter = build(tokens);
  return { filter, unsupported };
}
