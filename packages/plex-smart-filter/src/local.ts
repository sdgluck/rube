/**
 * Local filter leaves — the part of a filter tree Plex cannot answer.
 *
 * Plex evaluates view state against the token that made the request, and
 * Rube queries with the server owner's. So `unwatched=1` means "the owner
 * hasn't watched it", never "nobody has". The questions that actually drive
 * collections and cleanup — watched by everyone, watched by nobody, played by
 * anyone in the last N days — have no Plex query form at all, so they are
 * evaluated locally against `watch_state` after Plex returns.
 *
 * This module owns the split. It lives beside `emit.ts`/`parse.ts` rather than
 * in `@rube/contracts` for two reasons: the round-trip tests are here,
 * and contracts already depends on this package — putting it there would close
 * a cycle. Contracts owns the *table* of local fields (labels, kinds); this
 * module owns the *convention* that identifies one.
 */
import type { SmartFilterGroup, SmartFilterLeaf, SmartFilterNode } from "./parse.ts";

/**
 * The prefix that marks a field as locally evaluated.
 *
 * Load-bearing rather than cosmetic: it guarantees no collision with a real
 * Plex field now or after a Plex update, and it makes a local field obvious in
 * a serialised rule config, a registry pack, and a log line — without a lookup
 * table that a caller might not have.
 */
export const LOCAL_FIELD_PREFIX = "tb.";

export function isLocalField(field: string): boolean {
  return field.startsWith(LOCAL_FIELD_PREFIX);
}

/** The one way splitting can fail. See `splitLocalLeaves`. */
export type SplitError = "local-leaf-in-or-group";

export interface SplitResult {
  /**
   * The Plex-emittable half. May have no children at all, meaning "every item
   * in the section" — the handler falls back to a section-wide query.
   */
  plexTree: SmartFilterGroup;
  /** Leaves to evaluate against `watch_state`, in tree order. AND'd together. */
  localLeaves: SmartFilterLeaf[];
  /** Set when the tree cannot be split. `plexTree`/`localLeaves` are empty. */
  error?: SplitError;
}

/**
 * A group's combinator only means something once it has two children: `any` of
 * one is identity, and the editors only surface the AND/OR toggle past that
 * point. Treating a one-child `any` as a real OR would reject trees that are
 * an artefact of editing and carry no OR semantics at all.
 */
function isOrGroup(group: SmartFilterGroup): boolean {
  return group.combinator === "any" && group.children.length > 1;
}

/**
 * Partition a tree into the part Plex can answer and the leaves we evaluate
 * ourselves.
 *
 * **This is only valid under AND.** For `genre=Horror AND watchedByAll`,
 * querying Plex for horror and filtering the result locally is exactly right.
 * For `genre=Horror OR watchedByAll` it is not: the Plex query returns only
 * horror films and the local pass can never add the watched-by-all non-horror
 * ones back. That case returns `error` rather than a plausible wrong answer —
 * the caller must check it before using either half.
 *
 * Supporting OR would mean fetching every item in the section and evaluating
 * the whole tree locally. Correct, but O(library) per rule per run; not built.
 * `NOT`, if the tree ever grows it, has the same constraint.
 *
 * Groups emptied by the split are pruned so the Plex half emits exactly as the
 * original would minus the local leaves — an empty `any` group would otherwise
 * emit a bare `push=1&pop=1`.
 */
export function splitLocalLeaves(tree: SmartFilterGroup): SplitResult {
  const localLeaves: SmartFilterLeaf[] = [];
  let error: SplitError | undefined;

  /** Returns the Plex-side node, or null if it holds nothing Plex can answer. */
  function walk(node: SmartFilterNode, underOr: boolean): SmartFilterNode | null {
    if (node.kind === "leaf") {
      if (!isLocalField(node.field)) return node;
      // Reached through an OR at any depth — the two halves can't be recombined.
      if (underOr) error ??= "local-leaf-in-or-group";
      else localLeaves.push(node);
      return null;
    }

    const nestedUnderOr = underOr || isOrGroup(node);
    const children: SmartFilterNode[] = [];
    for (const child of node.children) {
      const kept = walk(child, nestedUnderOr);
      if (kept) children.push(kept);
    }
    if (children.length === 0) return null;
    return { ...node, children };
  }

  const root = walk(tree, isOrGroup(tree));

  if (error) return { plexTree: { kind: "group", combinator: "all", children: [] }, localLeaves: [], error };

  // `walk` only ever returns a group for a group, and only null when empty.
  const plexTree: SmartFilterGroup =
    root && root.kind === "group" ? root : { kind: "group", combinator: tree.combinator, children: [] };

  return { plexTree, localLeaves };
}

/** Every local leaf in a tree, regardless of where it sits. For validation. */
export function collectLocalLeaves(node: SmartFilterNode, into: SmartFilterLeaf[] = []): SmartFilterLeaf[] {
  if (node.kind === "leaf") {
    if (isLocalField(node.field)) into.push(node);
    return into;
  }
  for (const child of node.children) collectLocalLeaves(child, into);
  return into;
}

/** True when the tree references any locally-evaluated field. */
export function hasLocalLeaves(tree: SmartFilterGroup): boolean {
  return collectLocalLeaves(tree).length > 0;
}
