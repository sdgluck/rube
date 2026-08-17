/**
 * Where a smart filter's items went.
 *
 * A rule that matches nothing is the worst moment in the wizard: the test says
 * "0 items", and every one of the six clauses is equally suspect. The funnel
 * answers it by asking Plex the same query repeatedly with one more clause each
 * time — 4,312 → genre → 812 → rating → 63 → watched-by-nobody → 0 names the
 * clause that did it.
 *
 * Built during a *test*, and by `diagnose` when a real run matched nothing at
 * all — the same question, asked at the only other moment anybody wants it. It
 * costs one count per clause per section, which is fine for something a person
 * pressed, or for a run that has already found nothing, and far too much for the
 * nightly pass over rules that are working.
 */

import { SECTION_TYPE_MAP, type PlexClient, type PlexSection } from "@tinkerbell/plex";
import {
  emitSmartFilterTree,
  splitLocalLeaves,
  type SmartFilterGroup,
  type SmartFilterLeaf,
  type SmartFilterNode,
  type SmartFilterOp,
} from "@tinkerbell/plex-smart-filter";
import { describeCondition } from "@tinkerbell/contracts";
import { completionThreshold, evaluateLocal, watchStateFor, watchStateUserScope } from "@tinkerbell/domain.playback";
import type { JobContext } from "@tinkerbell/core";

export interface FunnelStep {
  /** The clause as a sentence fragment — "Genre is Horror". */
  label: string;
  /** How many items survive once this clause has been applied. */
  remaining: number;
  /** How many this clause eliminated. */
  removed: number;
  /** Which half evaluated it: pushed into the Plex query, or applied here. */
  source: "plex" | "local";
}

export interface SectionFunnel {
  sectionTitle: string;
  /** Everything of the right type in the library, before any clause. */
  start: number;
  steps: FunnelStep[];
  final: number;
  /**
   * "narrowing" — an AND root, so each clause is applied on top of the last and
   * the counts fall monotonically.
   *
   * "contributing" — an OR root, where a cumulative funnel would be a lie:
   * each branch is measured on its own against the whole library, and the
   * final count is the union rather than the last step.
   */
  mode: "narrowing" | "contributing";
}

/** A group's direct children, which are what a funnel has one step per. */
function topLevelBranches(tree: SmartFilterGroup): SmartFilterNode[] {
  return tree.children;
}

/**
 * A branch as a sentence fragment.
 *
 * A leaf gets the same phrasing the filter editor shows. A nested group gets
 * counted, not spelled out — "3 clauses (any)" is honest about there being
 * something inside without inventing a sentence for an arbitrary tree.
 */
export function describeBranch(node: SmartFilterNode): string {
  if (node.kind === "leaf") {
    return describeCondition(node.field, node.op as SmartFilterOp, [node.value]);
  }
  const n = node.children.length;
  return `${n} clause${n === 1 ? "" : "s"} (${node.combinator === "any" ? "any" : "all"})`;
}

/** The Plex query for a set of branches combined the way the root combines them. */
function pathFor(section: PlexSection, combinator: "all" | "any", branches: SmartFilterNode[]): string {
  const parts: string[] = [];
  const typeNum = SECTION_TYPE_MAP[section.type];
  if (typeNum != null) parts.push(`type=${typeNum}`);
  if (branches.length > 0) {
    parts.push(...emitSmartFilterTree({ kind: "group", combinator, children: branches }));
  }
  return `/library/sections/${section.key}/all?${parts.join("&")}`;
}

export interface BuildFunnelOptions {
  ctx: JobContext;
  client: PlexClient;
  sections: PlexSection[];
  filter: SmartFilterGroup;
}

/**
 * Build one funnel per section.
 *
 * Never throws: a funnel is an explanation of a result the caller already has,
 * and failing to explain it must not fail the test that produced it. A section
 * whose counts couldn't be fetched is simply left out.
 */
export async function buildFilterFunnel(opts: BuildFunnelOptions): Promise<SectionFunnel[]> {
  const { ctx, client, sections, filter } = opts;
  const { plexTree, localLeaves, error } = splitLocalLeaves(filter);
  // The OR-with-local-leaves case has no valid split, so it has no valid
  // funnel either — the handler already fails loudly for it.
  if (error) return [];

  const mode = plexTree.combinator === "any" ? "contributing" : "narrowing";
  const branches = topLevelBranches(plexTree);
  const funnels: SectionFunnel[] = [];

  for (const section of sections) {
    ctx.signal?.throwIfAborted();
    try {
      funnels.push(await funnelForSection({ ctx, client, section, plexTree, branches, localLeaves, mode }));
    } catch (err) {
      ctx.log(`[Funnel] Couldn't measure "${section.title}":`, err);
    }
  }
  return funnels;
}

async function funnelForSection(args: {
  ctx: JobContext;
  client: PlexClient;
  section: PlexSection;
  plexTree: SmartFilterGroup;
  branches: SmartFilterNode[];
  localLeaves: SmartFilterLeaf[];
  mode: "narrowing" | "contributing";
}): Promise<SectionFunnel> {
  const { ctx, client, section, plexTree, branches, localLeaves, mode } = args;

  const start = await client.countItemsByFilter(pathFor(section, plexTree.combinator, []));
  const steps: FunnelStep[] = [];
  let running = start;

  for (let i = 0; i < branches.length; i++) {
    ctx.signal?.throwIfAborted();
    // Narrowing asks "how many survive the first i+1 clauses"; contributing
    // asks "how many does this one branch match at all", because under OR the
    // set grows rather than shrinks and a cumulative count would mislead.
    const applied = mode === "narrowing" ? branches.slice(0, i + 1) : [branches[i]!];
    const remaining = await client.countItemsByFilter(pathFor(section, plexTree.combinator, applied));
    steps.push({
      label: describeBranch(branches[i]!),
      remaining,
      removed: mode === "narrowing" ? Math.max(0, running - remaining) : 0,
      source: "plex",
    });
    if (mode === "narrowing") running = remaining;
  }

  // Under OR the union is the whole query, which is one more count rather than
  // anything the per-branch numbers can be added up to.
  if (mode === "contributing") {
    running = await client.countItemsByFilter(pathFor(section, plexTree.combinator, branches));
  }

  // The local half can only be measured by fetching the rows — there is no
  // count endpoint for something Plex doesn't evaluate. Only paid when the
  // rule actually has watch-state clauses.
  if (localLeaves.length > 0) {
    const items = await client.fetchItemsByFilter(pathFor(section, plexTree.combinator, branches));
    const scope = watchStateUserScope();
    const localCtx = { userIds: scope.userIds, now: Date.now(), completionThreshold: completionThreshold() };
    let surviving = items;
    for (const leaf of localLeaves) {
      const state = watchStateFor(surviving.map((m) => m.ratingKey));
      const next = surviving.filter((item) => evaluateLocal(leaf, state.get(item.ratingKey), localCtx));
      steps.push({
        label: describeCondition(leaf.field, leaf.op as SmartFilterOp, [leaf.value]),
        remaining: next.length,
        removed: surviving.length - next.length,
        source: "local",
      });
      surviving = next;
    }
    running = surviving.length;
  }

  return { sectionTitle: section.title, start, steps, final: running, mode };
}
