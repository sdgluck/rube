import { type Services } from "@rube/composition";

import { indexItemsByTmdb } from "#commands/generate/plex-index.ts";
import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export function createSeerrRequestsCommand(deps: Pick<Services, "config">) {
  const { config } = deps;
  const { getConfig } = config;

  /**
   * Pull recent Seerr requests, match each against the host section's TMDb
   * IDs, and emit a single collection (named after the rule) up to `limit`.
   *
   * Seerr requests yield one collection — Plex collections are section-scoped,
   * so we pick the first movie/show section the user selected as the host.
   */
  async function* seerrRequestsHandler(deps: HandlerDeps): AsyncGenerator<PendingCollection> {
    const { ctx, client, sections, rule, ruleConfig } = deps;

    const seerrUrl = getConfig("global_seerr_url");
    const seerrApiKey = getConfig("global_seerr_api_key");
    if (!seerrUrl || !seerrApiKey) {
      throw new Error("Seerr URL and API key are required. Configure them in Settings > Arrs.");
    }

    const limit = Math.min(ruleConfig.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const filter = ruleConfig.filter || "all";

    const hostSection = sections.find((s) => s.type === "movie" || s.type === "show");
    if (!hostSection) {
      ctx.log(`[Seerr Requests] No movie or show sections selected, skipping.`);
      return;
    }
    const sectionMediaType = hostSection.type === "movie" ? "movie" : "tv";
    ctx.log(`[Seerr Requests] Host section: "${hostSection.title}" (${sectionMediaType})`);

    ctx.log(`[Seerr Requests] Indexing "${hostSection.title}" by TMDB ID...`);
    const { items, tmdbToItem } = await indexItemsByTmdb(client, hostSection.key);
    ctx.log(`[Seerr Requests] ${tmdbToItem.size}/${items.length} items have TMDB IDs.`);

    ctx.log(`[Seerr Requests] Streaming Seerr requests (filter=${filter}) until ${limit} matches...`);
    const { iterSeerrRequests } = await import("@rube/seerr");
    const matched: Array<{ ratingKey: string; title: string; year?: number }> = [];
    const seen = new Set<string>();
    let scanned = 0;
    for await (const req of iterSeerrRequests({ url: seerrUrl, apiKey: seerrApiKey, filter })) {
      ctx.signal?.throwIfAborted();
      scanned++;
      if (req.media.mediaType !== sectionMediaType) continue;
      const item = tmdbToItem.get(req.media.tmdbId);
      if (!item || seen.has(item.ratingKey)) continue;
      seen.add(item.ratingKey);
      matched.push(item);
      if (matched.length >= limit) break;
    }
    ctx.log(`[Seerr Requests] Scanned ${scanned} request(s); matched ${matched.length}/${limit}.`);

    if (matched.length === 0) {
      ctx.log(`[Seerr Requests] No matching items in "${hostSection.title}", skipping.`);
      return;
    }

    yield { name: rule.name, section: hostSection, matched };
  }

  return { seerrRequestsHandler };
}
