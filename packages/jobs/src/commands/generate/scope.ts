/**
 * A grouped rule's `scope` and `nameTemplate`, applied around its handler.
 *
 * Grouped handlers group whatever the Plex client's full-library walks hand
 * them. Narrowing those walks is what makes "Horror Through the Decades" mean
 * horror: before this, a rule could only drop whole groups, so on a mixed
 * library its 2020s shelf held all 1,117 of that decade's films. Doing it at
 * the client rather than in each handler means every grouped type gets it,
 * and limits and minimums count only what is in scope.
 *
 * The scope is one Plex query per library, fetched once and cached for the
 * run like the walks themselves.
 */
import { SECTION_TYPE_MAP, type PlexClient, type PlexSection } from "@rube/plex";
import { SCOPABLE_RULE_TYPES, applyNameTemplate } from "@rube/contracts";
import { filterTreeToPlexParams } from "#commands/generate/handlers/smart-filter.ts";
import type { Handler, HandlerDeps } from "#commands/generate/types.ts";

/** A client whose full-library walks return only what `scope` matches. */
export function scopedClient(
  client: PlexClient,
  sections: PlexSection[],
  scope: NonNullable<HandlerDeps["ruleConfig"]["scope"]>,
  log: (msg: string) => void,
): PlexClient {
  const inScope = new Map<string, Promise<Set<string>>>();
  const keysFor = (sectionId: string): Promise<Set<string>> => {
    let hit = inScope.get(sectionId);
    if (!hit) {
      const type = sections.find((s) => s.key === sectionId)?.type ?? "movie";
      const params = scope.children.length ? filterTreeToPlexParams(scope, type) : `type=${SECTION_TYPE_MAP[type]}`;
      hit = client.fetchItemsByFilter(`/library/sections/${sectionId}/all?${params}`).then((items) => {
        log(`[scope] library ${sectionId}: ${items.length} item(s) in scope.`);
        return new Set(items.map((i) => i.ratingKey));
      });
      hit.catch(() => inScope.delete(sectionId));
      inScope.set(sectionId, hit);
    }
    return hit;
  };

  return {
    ...client,
    allItemsWithGuids: async (sectionId) => {
      const [items, keys] = await Promise.all([client.allItemsWithGuids(sectionId), keysFor(sectionId)]);
      return items.filter((i) => keys.has(i.ratingKey));
    },
    allItems: async function* (sectionId, opts) {
      const keys = await keysFor(sectionId);
      for await (const page of client.allItems(sectionId, opts)) {
        if (page.item.ratingKey && keys.has(page.item.ratingKey)) yield page;
      }
    },
  };
}

/**
 * The deps and handler a rule actually runs with: its client narrowed to its
 * scope, and its collections titled by its template. A no-op for any rule
 * without either, and for rule types that don't group.
 */
export function prepareHandlerRun(deps: HandlerDeps, handler: Handler): { deps: HandlerDeps; handler: Handler } {
  const { rule, ruleConfig } = deps;
  if (!SCOPABLE_RULE_TYPES.has(rule.type)) return { deps, handler };

  const scope = ruleConfig.scope?.children.length ? ruleConfig.scope : undefined;
  const template = ruleConfig.nameTemplate;
  if (!scope && !template) return { deps, handler };

  const prepared: HandlerDeps = scope
    ? { ...deps, client: scopedClient(deps.client, deps.sections, scope, (m) => deps.ctx.log(m)) }
    : deps;
  const named: Handler = template
    ? async function* (d) {
        for await (const pending of handler(d)) {
          yield { ...pending, name: applyNameTemplate(template, pending.name), groupLabel: pending.name };
        }
      }
    : handler;
  return { deps: prepared, handler: named };
}
