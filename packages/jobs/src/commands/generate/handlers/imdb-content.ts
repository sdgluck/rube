import { type Services } from "@rube/composition";
import { createImdbCommand } from "../sources/imdb.ts";
import { indexItemsByImdb } from "#commands/generate/plex-index.ts";

import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";

export function createImdbContentCommand(deps: Services) {
  const { fetchImdbChart, fetchImdbList } = createImdbCommand(deps);

  /**
   * IMDb chart or list → one collection per section, named after the chart/
   * list, populated with items the section already has by IMDb GUID match.
   */
  function imdbContentHandler(kind: "chart" | "list") {
    return async function* (deps: HandlerDeps): AsyncGenerator<PendingCollection> {
      const { ctx, client, sections, ruleConfig } = deps;
      const contentId = kind === "chart" ? ruleConfig.chart : ruleConfig.listId;
      if (!contentId) throw new Error(`IMDb ${kind} ID is required.`);

      ctx.log(`Fetching IMDb ${kind} "${contentId}"...`);
      const { name: contentName, imdbIds } =
        kind === "chart" ? await fetchImdbChart(contentId) : await fetchImdbList(contentId);
      ctx.log(`Found ${imdbIds.length} title(s) in "${contentName}".`);

      for (const section of sections) {
        ctx.log(`[${contentName}] "${section.title}" — matching against library...`);
        const { imdbToItem } = await indexItemsByImdb(client, section.key);

        const matched = imdbIds.map((id) => imdbToItem.get(id)).filter((m): m is NonNullable<typeof m> => !!m);

        if (matched.length === 0) {
          ctx.log(`No matching items found in "${section.title}", skipping.`);
          continue;
        }

        yield { name: contentName, section, matched };
      }
    };
  }

  return { imdbContentHandler };
}
