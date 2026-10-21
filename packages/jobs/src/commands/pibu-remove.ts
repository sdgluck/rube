/**
 * Tears down Pick It Back Up: deletes every collection it labelled.
 *
 * Like `wtyl-remove`, and unlike `byw-remove`, it leaves sharing restrictions alone. Those belong to
 * Personalized Home Screens, which is still on for the other personal rows and the personalized
 * rules; clearing them here would expose every other person's rows the moment
 * this one feature was removed.
 *
 * Every section, not only the managed ones or the job's own: a library taken
 * out of Settings since the row was made still has the row in it, and removing
 * the feature should leave nothing of it behind.
 */
import { ServicesToken, type Services } from "@rube/composition";
import { createPlexClient } from "@rube/plex";
import type { JobContext } from "@rube/core";
import { plexConnection } from "./ai-collection-shared.ts";
import { PIBU_LABEL } from "./pick-it-back-up/index.ts";

export function createPibuRemoveCommand(deps: Pick<Services, "clients" | "collections" | "config">) {
  const { clients, collections, config } = deps;
  const { plexHealthCallback } = clients;
  const { getConfig } = config;
  const { forgetCollections } = collections;

  async function run(ctx: JobContext): Promise<void> {
    const { url, token } = plexConnection(getConfig);
    if (!token) throw new Error("Plex token is required. Configure it in Settings.");

    const client = createPlexClient({ url, token, signal: ctx.signal, onHealth: plexHealthCallback });
    ctx.log(`rube pibu-remove`);
    ctx.log(`Server: ${url}`);

    const sections = await client.getSections();
    let total = 0;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      ctx.progress(i, sections.length, `Scanning "${section.title}"...`);
      const deleted = await client.deleteCollectionsByLabel(section.key, PIBU_LABEL);
      // The cache rows too, or the Collections page keeps listing them.
      forgetCollections(deleted);
      if (deleted.length > 0) ctx.log(`Deleted ${deleted.length} collection(s) in "${section.title}".`);
      total += deleted.length;
    }
    ctx.log(`Deleted ${total} Pick It Back Up collection(s).`);
  }

  return { run };
}

export default function run(ctx: JobContext): Promise<void> {
  return createPibuRemoveCommand(ctx.scope.resolve(ServicesToken)).run(ctx);
}
