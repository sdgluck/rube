/**
 * Tears down Season Collections: deletes every collection it labelled.
 *
 * Like `pibu-remove`, and unlike `byw-remove`, it leaves sharing restrictions
 * alone. In per-person mode those belong to Personalized Home Screens, which is
 * still on for the other personal rows; in the default mode they were never
 * this feature's to begin with.
 *
 * Every section, not only the job's own: a library taken out of its settings
 * since a row was made still has the row in it.
 */
import { ServicesToken, type Services } from "@rube/composition";
import { createPlexClient } from "@rube/plex";
import type { JobContext } from "@rube/core";
import { plexConnection } from "./ai-collection-shared.ts";
import { SEASON_LABEL } from "./season-collections/match.ts";

export function createSeasonRemoveCommand(deps: Pick<Services, "clients" | "collections" | "config">) {
  const { clients, collections, config } = deps;
  const { plexHealthCallback } = clients;
  const { getConfig } = config;
  const { forgetCollections } = collections;

  async function run(ctx: JobContext): Promise<void> {
    const { url, token } = plexConnection(getConfig);
    if (!token) throw new Error("Plex token is required. Configure it in Settings.");

    const client = createPlexClient({ url, token, signal: ctx.signal, onHealth: plexHealthCallback });
    ctx.log(`rube season-remove`);
    ctx.log(`Server: ${url}`);

    const sections = await client.getSections();
    let total = 0;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      ctx.progress(i, sections.length, `Scanning "${section.title}"...`);
      const deleted = await client.deleteCollectionsByLabel(section.key, SEASON_LABEL);
      // The cache rows too, or the Collections page keeps listing them.
      forgetCollections(deleted);
      if (deleted.length > 0) ctx.log(`Deleted ${deleted.length} collection(s) in "${section.title}".`);
      total += deleted.length;
    }
    ctx.log(`Deleted ${total} Season Collections collection(s).`);
  }

  return { run };
}

export default function run(ctx: JobContext): Promise<void> {
  return createSeasonRemoveCommand(ctx.scope.resolve(ServicesToken)).run(ctx);
}
