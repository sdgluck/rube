import { SECTION_TYPE_MAP } from "@tinkerbell/plex";
import {
  emitSmartFilterTree,
  splitLocalLeaves,
  type SmartFilterGroup,
  type SmartFilterLeaf,
  type SmartFilterNode,
} from "@tinkerbell/plex-smart-filter";
import {
  completionThreshold,
  evaluateLocal,
  watchStateFor,
  watchStateUserScope,
  type LocalEvalContext,
} from "@tinkerbell/domain.playback";
import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";

/**
 * Convert the filter tree + section context into a Plex query string.
 * Plex requires the `type` parameter (movie=1, show=2, …) on filtered
 * `/library/sections/N/all` queries; section type drives that. The
 * tree-to-fragments work lives in `@tinkerbell/migrate` so the parser
 * and emitter stay together for round-trip testing.
 */
export function filterTreeToPlexParams(filter: SmartFilterGroup, sectionType: string): string {
  const parts: string[] = [];
  const typeNum = SECTION_TYPE_MAP[sectionType];
  if (typeNum != null) parts.push(`type=${typeNum}`);
  parts.push(...emitSmartFilterTree(filter));
  return parts.join("&");
}

function countLeaves(node: SmartFilterNode): number {
  return node.kind === "leaf" ? 1 : node.children.reduce((sum, c) => sum + countLeaves(c), 0);
}

export const smartFilterHandler = async function* (deps: HandlerDeps): AsyncGenerator<PendingCollection> {
  const { ctx, client, sections, ruleConfig } = deps;
  const filter = ruleConfig.smartFilter;
  if (!filter || filter.children.length === 0) {
    throw new Error("Smart filter rule has no filter clauses.");
  }

  // Watch-state clauses can't be pushed into the Plex query — Plex evaluates
  // view state against the requesting token, and ours is the owner's. Split
  // them out and apply them to what Plex returns.
  const { plexTree, localLeaves, error } = splitLocalLeaves(filter);
  if (error === "local-leaf-in-or-group") {
    // `ruleConfigSchema` rejects this at save time; a rule that predates the
    // check or arrived another way fails loudly rather than running a query
    // that can only return the wrong set.
    throw new Error(
      "Watch-history fields can only be combined with AND. This rule puts one inside an OR group, where the Plex query could never return the items the local filter needs.",
    );
  }

  const collectionName = ruleConfig.collectionName?.trim() || "Smart Filter";
  const plexLeaves = countLeaves(plexTree);

  const localCtx = localLeaves.length ? localEvalContext(ctx.log, localLeaves) : null;

  for (const section of sections) {
    ctx.signal?.throwIfAborted();

    // An empty Plex half is legitimate — a rule of nothing but watch-state
    // clauses asks about the whole section, so that is what we fetch.
    const params = plexTree.children.length
      ? filterTreeToPlexParams(plexTree, section.type)
      : `type=${SECTION_TYPE_MAP[section.type]}`;
    ctx.log(
      `[Smart Filter] "${section.title}" — querying Plex with ${plexLeaves} clause(s)` +
        (localLeaves.length ? ` and ${localLeaves.length} watch-history clause(s)...` : "..."),
    );

    const path = `/library/sections/${section.key}/all?${params}`;
    let matched = await client.fetchItemsByFilter(path);

    if (localCtx) {
      const fromPlex = matched.length;
      const state = watchStateFor(matched.map((m) => m.ratingKey));
      matched = matched.filter((item) =>
        localLeaves.every((leaf) => evaluateLocal(leaf, state.get(item.ratingKey), localCtx)),
      );
      // Both numbers, always. A preview showing only the final count hides the
      // case where the Plex half is wrong and the local half happens to mask it.
      ctx.log(
        `[Smart Filter] "${section.title}" — Plex returned ${fromPlex}; ${matched.length} matched after watch-state filtering.`,
      );
    }

    if (matched.length === 0) {
      ctx.log(`No matching items in "${section.title}", skipping.`);
      continue;
    }

    yield { name: collectionName, section, matched };
  }
};

/**
 * Resolve the user set once per run and say so in the log.
 *
 * A rule that can drive a deletion must make its definition of "everyone"
 * visible, and the empty case needs calling out by name: it makes
 * `tb.watchedByAll` false for every item, which looks exactly like a library
 * nobody has finished.
 */
function localEvalContext(log: (...args: unknown[]) => void, localLeaves: SmartFilterLeaf[]): LocalEvalContext {
  const scope = watchStateUserScope();
  const needsUserSet = localLeaves.some((l) => l.field === "tb.watchedByAll");

  if (scope.userIds.length === 0) {
    log(
      "[Smart Filter] No users resolved for watch-state filtering — sync users in Settings" +
        (scope.includeOwner ? "" : ", or set watch_state_all_users_include_owner on a server with no shared users") +
        (needsUserSet ? '. "Watched by everyone" will match nothing.' : "."),
    );
  } else {
    log(
      `[Smart Filter] "Everyone" resolves to ${scope.userIds.length} user(s): ${scope.usernames.join(", ")}` +
        (scope.includeOwner ? " (owner included)." : " (owner excluded)."),
    );
  }

  return { userIds: scope.userIds, now: Date.now(), completionThreshold: completionThreshold() };
}
