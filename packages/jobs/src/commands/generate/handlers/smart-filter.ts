import { SECTION_TYPE_MAP } from "@tinkerbell/plex";
import { emitSmartFilterTree, type SmartFilterGroup, type SmartFilterNode } from "@tinkerbell/plex-smart-filter";
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

  const collectionName = ruleConfig.collectionName?.trim() || "Smart Filter";
  const totalLeaves = countLeaves(filter);

  for (const section of sections) {
    ctx.signal?.throwIfAborted();
    const params = filterTreeToPlexParams(filter, section.type);
    ctx.log(`[Smart Filter] "${section.title}" — querying Plex with ${totalLeaves} clause(s)...`);

    const path = `/library/sections/${section.key}/all?${params}`;
    const matched = await client.fetchItemsByFilter(path);

    if (matched.length === 0) {
      ctx.log(`No matching items in "${section.title}", skipping.`);
      continue;
    }

    yield { name: collectionName, section, matched };
  }
};
