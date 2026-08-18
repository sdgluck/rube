/**
 * Why one item does — or doesn't — match one rule.
 *
 * The funnel answers this for a whole library: 4,312 → genre → 812 → rating →
 * 63 → 0 names the clause that emptied the set. It cannot answer it for the
 * film you are actually looking at, and "why isn't *this* in that collection"
 * is the question people actually ask. Until now nothing could: `rules.test`
 * takes a rule id and nothing else, and the funnel is aggregate-only.
 *
 * The trick that makes it cheap is the title constraint. Asking Plex "does
 * anything match this clause" over a whole library and then checking whether
 * our item is in the answer means fetching thousands of rows per clause; the
 * same query narrowed by the item's own title returns a handful. Membership
 * is still decided on the rating key, so an inexact or shared title costs a
 * few extra rows and never a wrong answer — and if Plex ignores the parameter
 * entirely, the query degrades to the slow-but-correct version rather than to
 * a wrong one.
 */
import { SECTION_TYPE_MAP, type PlexClient } from "@tinkerbell/plex";
import {
  emitSmartFilterTree,
  splitLocalLeaves,
  type SmartFilterGroup,
  type SmartFilterNode,
  type SmartFilterOp,
} from "@tinkerbell/plex-smart-filter";
import { describeCondition, ruleCoversSection } from "@tinkerbell/contracts";
import { evaluateLocal, type Playback } from "@tinkerbell/domain.playback";

/**
 * A branch as a sentence fragment.
 *
 * Same shape as the funnel's: a leaf gets the phrasing the filter editor
 * shows, a nested group is counted rather than spelled out, because inventing
 * a sentence for an arbitrary tree reads worse than admitting there are three
 * clauses inside it.
 */
function describeBranchLabel(node: SmartFilterNode): string {
  if (node.kind === "leaf") return describeCondition(node.field, node.op as SmartFilterOp, [node.value]);
  const n = node.children.length;
  return `${n} clause${n === 1 ? "" : "s"} (${node.combinator === "any" ? "any" : "all"})`;
}

export interface ClauseVerdict {
  /** The clause as a sentence fragment — "Genre is Horror". */
  label: string;
  passed: boolean;
  /** Which half decided it: pushed into the Plex query, or evaluated here. */
  source: "plex" | "local";
}

export interface ItemExplanation {
  ratingKey: string;
  itemTitle: string;
  /** Whether the rule's filter selects this item at all. */
  matches: boolean;
  /**
   * Set when the answer is decided before any clause is evaluated — the item
   * is in a library the rule doesn't cover, or the rule has no filter to
   * evaluate. The clause list is empty in that case, and this says why.
   */
  reason?: string;
  /** How the clauses combine: every one must pass, or any one of them.  */
  combinator: "all" | "any";
  clauses: ClauseVerdict[];
}

export interface ExplainOptions {
  client: PlexClient;
  ratingKey: string;
  filter: SmartFilterGroup;
  /**
   * Libraries the rule is scoped to — titles or section keys, whichever the
   * config holds. Empty means all of them.
   */
  ruleSectionTitles: string[];
  /** Every library, so the item's own one can be found. */
  sections: Array<{ key: string; title: string; type: string }>;
}

/** The Plex query for one branch, narrowed to items sharing this title. */
function pathForBranch(
  section: { key: string; type: string },
  combinator: "all" | "any",
  branches: SmartFilterNode[],
  title: string,
): string {
  const parts: string[] = [];
  const typeNum = SECTION_TYPE_MAP[section.type];
  if (typeNum != null) parts.push(`type=${typeNum}`);
  if (branches.length > 0) parts.push(...emitSmartFilterTree({ kind: "group", combinator, children: branches }));
  parts.push(`title=${encodeURIComponent(title)}`);
  return `/library/sections/${section.key}/all?${parts.join("&")}`;
}

export interface ExplainDeps {
  playback: Playback;
}
export function createExplain(deps: ExplainDeps) {
  const { completionThreshold, watchStateFor, watchStateUserScope } = deps.playback;

  /**
   * Evaluate each of a rule's top-level clauses against one item.
   *
   * Top-level only, matching the funnel: a nested group is reported as a single
   * clause that passed or didn't, rather than expanded into a tree nobody asked
   * to read. The clause that fails is the one people are looking for, and it is
   * almost always at the top.
   */
  async function explainItem(opts: ExplainOptions): Promise<ItemExplanation> {
    const { client, ratingKey, filter, ruleSectionTitles, sections } = opts;

    const detail = await client.getItemFields(ratingKey);
    const itemTitle = detail.title;
    const section = sections.find((s) => s.key === detail.sectionId);

    const base = { ratingKey, itemTitle, combinator: filter.combinator, clauses: [] as ClauseVerdict[] };

    if (!section) {
      return { ...base, matches: false, reason: "Plex didn't say which library this item is in." };
    }

    // Scope first. A rule that doesn't cover the library is the commonest
    // answer by far, and evaluating six clauses before saying so would be a
    // slower way of being unhelpful.
    //
    // Asked through `ruleCoversSection` so this agrees with the engine: a rule
    // whose sections were saved as keys rather than titles is covered by the run
    // and used to be reported here as out of scope.
    if (!ruleCoversSection(ruleSectionTitles, section)) {
      return {
        ...base,
        matches: false,
        reason: `This rule only covers ${ruleSectionTitles.join(", ")}, and this item is in ${section.title}.`,
      };
    }

    const { plexTree, localLeaves, error } = splitLocalLeaves(filter);
    if (error) {
      return {
        ...base,
        matches: false,
        reason: "This rule mixes watch-state clauses into an OR, which can't be split.",
      };
    }

    const branches = plexTree.children;
    if (branches.length === 0 && localLeaves.length === 0) {
      return { ...base, matches: true, reason: "This rule has no filter, so it matches everything in its libraries." };
    }

    const clauses: ClauseVerdict[] = [];

    for (const branch of branches) {
      const path = pathForBranch(section, plexTree.combinator, [branch], itemTitle);
      const found = await client.fetchItemsByFilter(path);
      clauses.push({
        label: describeBranchLabel(branch),
        passed: found.some((item) => item.ratingKey === ratingKey),
        source: "plex",
      });
    }

    if (localLeaves.length > 0) {
      const state = watchStateFor([ratingKey]);
      const scope = watchStateUserScope();
      const localCtx = { userIds: scope.userIds, now: Date.now(), completionThreshold: completionThreshold() };
      for (const leaf of localLeaves) {
        clauses.push({
          label: describeCondition(leaf.field, leaf.op as SmartFilterOp, [leaf.value]),
          passed: evaluateLocal(leaf, state.get(ratingKey), localCtx),
          source: "local",
        });
      }
    }

    // The Plex half combines the way the tree says; the local half is always
    // AND'd on top, which is the same shape the generate handler applies.
    const plexClauses = clauses.filter((c) => c.source === "plex");
    const localClauses = clauses.filter((c) => c.source === "local");
    const plexPassed =
      plexClauses.length === 0
        ? true
        : plexTree.combinator === "any"
          ? plexClauses.some((c) => c.passed)
          : plexClauses.every((c) => c.passed);
    const matches = plexPassed && localClauses.every((c) => c.passed);

    return { ...base, matches, clauses };
  }

  return { explainItem };
}
