import assert from "node:assert/strict";
import { test } from "node:test";
import { emitSmartFilterTree } from "./emit.ts";
import { isLocalField, splitLocalLeaves } from "./local.ts";
import { parseSmartFilterUri } from "./parse.ts";
import type { SmartFilterGroup, SmartFilterLeaf, SmartFilterNode, SmartFilterOp } from "./parse.ts";

function leaf(field: string, op: SmartFilterOp = "=", value = "1"): SmartFilterLeaf {
  return { kind: "leaf", field, op, value };
}

function all(...children: SmartFilterNode[]): SmartFilterGroup {
  return { kind: "group", combinator: "all", children };
}

function any(...children: SmartFilterNode[]): SmartFilterGroup {
  return { kind: "group", combinator: "any", children };
}

// ─── isLocalField ────────────────────────────────────────────────────────────

test("isLocalField keys off the tb. prefix and nothing else", () => {
  assert.equal(isLocalField("tb.watchedByAll"), true);
  assert.equal(isLocalField("tb.anythingAtAll"), true);
  assert.equal(isLocalField("genre"), false);
  assert.equal(isLocalField("unwatched"), false);
  // A Plex field that merely contains the prefix is not local.
  assert.equal(isLocalField("show.tb.watchedByAll"), false);
  assert.equal(isLocalField("tbWatchedByAll"), false);
});

// ─── Clean AND-only splits ───────────────────────────────────────────────────

test("a tree with no local leaves is returned unchanged, with no local half", () => {
  const tree = all(leaf("genre", "=", "Horror"), leaf("year", ">=", "2000"));
  const { plexTree, localLeaves, error } = splitLocalLeaves(tree);
  assert.equal(error, undefined);
  assert.deepEqual(localLeaves, []);
  assert.deepEqual(plexTree, tree);
});

test("AND at the root: the local leaf is lifted out and the Plex half keeps the rest", () => {
  const tree = all(leaf("genre", "=", "Horror"), leaf("tb.watchedByAll"));
  const { plexTree, localLeaves, error } = splitLocalLeaves(tree);
  assert.equal(error, undefined);
  assert.deepEqual(localLeaves, [leaf("tb.watchedByAll")]);
  assert.deepEqual(plexTree, all(leaf("genre", "=", "Horror")));
});

test("the Plex half emits identically to the original minus the local leaves", () => {
  const original = all(
    leaf("genre", "=", "Horror"),
    leaf("tb.watchedByNobody"),
    any(leaf("director", "=", "4670"), leaf("director", "=", "20447")),
    leaf("year", ">=", "2000"),
  );
  const withoutLocal = all(
    leaf("genre", "=", "Horror"),
    any(leaf("director", "=", "4670"), leaf("director", "=", "20447")),
    leaf("year", ">=", "2000"),
  );
  const { plexTree } = splitLocalLeaves(original);
  assert.deepEqual(emitSmartFilterTree(plexTree), emitSmartFilterTree(withoutLocal));
});

test("local leaves nested under AND-only groups are lifted from any depth", () => {
  const tree = all(leaf("genre", "=", "Horror"), all(leaf("year", ">=", "2000"), all(leaf("tb.playCount", ">=", "3"))));
  const { plexTree, localLeaves, error } = splitLocalLeaves(tree);
  assert.equal(error, undefined);
  assert.deepEqual(localLeaves, [leaf("tb.playCount", ">=", "3")]);
  assert.deepEqual(plexTree, all(leaf("genre", "=", "Horror"), all(leaf("year", ">=", "2000"))));
});

test("several local leaves are collected in tree order", () => {
  const tree = all(leaf("tb.watchedByNobody"), leaf("genre", "=", "Horror"), leaf("tb.lastPlayedAt", ">=", "-30d"));
  const { localLeaves } = splitLocalLeaves(tree);
  assert.deepEqual(localLeaves, [leaf("tb.watchedByNobody"), leaf("tb.lastPlayedAt", ">=", "-30d")]);
});

test("an OR group with no local leaves is left alone, even beside a local leaf", () => {
  const tree = all(any(leaf("genre", "=", "Horror"), leaf("genre", "=", "Thriller")), leaf("tb.watchedByAll"));
  const { plexTree, localLeaves, error } = splitLocalLeaves(tree);
  assert.equal(error, undefined);
  assert.deepEqual(localLeaves, [leaf("tb.watchedByAll")]);
  assert.deepEqual(plexTree, all(any(leaf("genre", "=", "Horror"), leaf("genre", "=", "Thriller"))));
});

// ─── The correctness trap: OR ────────────────────────────────────────────────

test("a local leaf in an OR group is an error, not a silently wrong query", () => {
  const tree = any(leaf("genre", "=", "Horror"), leaf("tb.watchedByAll"));
  const { error, localLeaves } = splitLocalLeaves(tree);
  assert.equal(error, "local-leaf-in-or-group");
  // Nothing is handed back for evaluation — the caller must not proceed.
  assert.deepEqual(localLeaves, []);
});

test("a local leaf in a nested OR group is an error even when the root is AND", () => {
  const tree = all(leaf("year", ">=", "2000"), any(leaf("genre", "=", "Horror"), leaf("tb.watchedByNobody")));
  assert.equal(splitLocalLeaves(tree).error, "local-leaf-in-or-group");
});

test("a local leaf under an AND group nested inside an OR group is still an error", () => {
  // The AND is immediate, but the path to the root passes through an OR — so
  // the local half can never add back the rows the Plex half didn't return.
  const tree = any(leaf("genre", "=", "Horror"), all(leaf("year", ">=", "2000"), leaf("tb.watchedByAll")));
  assert.equal(splitLocalLeaves(tree).error, "local-leaf-in-or-group");
});

test("an OR group of exactly one child is not an OR — its combinator carries no meaning", () => {
  // `any` over a single child is identity. The wizard only shows the AND/OR
  // toggle once a group has two children, so a one-child `any` is an artefact
  // of editing, and rejecting it would be a UI dead end with no semantics
  // behind it.
  const tree = all(leaf("genre", "=", "Horror"), any(leaf("tb.watchedByAll")));
  const { plexTree, localLeaves, error } = splitLocalLeaves(tree);
  assert.equal(error, undefined);
  assert.deepEqual(localLeaves, [leaf("tb.watchedByAll")]);
  assert.deepEqual(plexTree, all(leaf("genre", "=", "Horror")));
});

test("a root OR group of one local leaf is accepted for the same reason", () => {
  const { error, localLeaves } = splitLocalLeaves(any(leaf("tb.watchedByAll")));
  assert.equal(error, undefined);
  assert.deepEqual(localLeaves, [leaf("tb.watchedByAll")]);
});

test("a negated local leaf under AND is fine — the negation is inside the leaf", () => {
  const tree = all(leaf("genre", "=", "Horror"), leaf("tb.watchedByAll", "!=", "1"));
  assert.equal(splitLocalLeaves(tree).error, undefined);
});

// ─── Empty Plex halves ───────────────────────────────────────────────────────

test("a tree of only local leaves produces an empty plexTree", () => {
  const tree = all(leaf("tb.watchedByNobody"), leaf("tb.playCount", "<", "2"));
  const { plexTree, localLeaves, error } = splitLocalLeaves(tree);
  assert.equal(error, undefined);
  assert.equal(localLeaves.length, 2);
  assert.deepEqual(plexTree.children, []);
});

test("groups emptied by the split are pruned, not left as empty push/pop blocks", () => {
  const tree = all(leaf("genre", "=", "Horror"), all(leaf("tb.watchedByAll")), any(leaf("tb.watchedByNobody")));
  const { plexTree } = splitLocalLeaves(tree);
  assert.deepEqual(plexTree, all(leaf("genre", "=", "Horror")));
  // An empty `any` group would have emitted a bare `push=1&pop=1`.
  assert.deepEqual(emitSmartFilterTree(plexTree), ["genre=Horror"]);
});

test("splitting is a pure function — the input tree is not mutated", () => {
  const tree = all(leaf("genre", "=", "Horror"), leaf("tb.watchedByAll"));
  const before = structuredClone(tree);
  splitLocalLeaves(tree);
  assert.deepEqual(tree, before);
});

// ─── Round-trip ──────────────────────────────────────────────────────────────

test("parse → split → emit → parse preserves the Plex half", () => {
  const uri = "/library/sections/1/all?type=1&genre=Horror&year>>=2000&push=1&director=4670&or=1&director=20447&pop=1";
  const parsed = parseSmartFilterUri(uri).filter;
  // Graft a local leaf onto the parsed tree, as the wizard would.
  const withLocal: SmartFilterGroup = { ...parsed, children: [...parsed.children, leaf("tb.watchedByAll")] };

  const { plexTree, localLeaves, error } = splitLocalLeaves(withLocal);
  assert.equal(error, undefined);
  assert.deepEqual(localLeaves, [leaf("tb.watchedByAll")]);

  const reparsed = parseSmartFilterUri(`/library/sections/1/all?${emitSmartFilterTree(plexTree).join("&")}`).filter;
  assert.deepEqual(reparsed, parsed);
});

test("a local leaf survives a parse → split round-trip through a stored config", () => {
  // Local leaves never reach Plex, but they do reach the emitter when a rule
  // config is serialised and read back. The leaf must come out identical.
  const tree = all(leaf("tb.watchedBy", "=", "12345"), leaf("genre", "=", "Horror"));
  const roundTripped: SmartFilterGroup = JSON.parse(JSON.stringify(tree));
  assert.deepEqual(splitLocalLeaves(roundTripped).localLeaves, [leaf("tb.watchedBy", "=", "12345")]);
});
