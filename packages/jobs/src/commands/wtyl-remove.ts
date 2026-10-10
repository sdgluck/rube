/**
 * Tears down We Think You'd Like: deletes every collection it labelled.
 *
 * Unlike `byw-remove` it leaves sharing restrictions alone. Those belong to
 * Personalized Home Screens, which is still on for BYW and the personalized
 * rules; clearing them here would expose every other person's rows the moment
 * this one feature was removed.
 *
 * Every section, not only the managed ones or the job's own: a library taken
 * out of Settings since the row was made still has the row in it, and removing
 * the feature should leave nothing of it behind.
 */
import { ServicesToken, type Services } from "@tinkerbell/composition";
import { createPlexClient } from "@tinkerbell/plex";
import type { JobContext } from "@tinkerbell/core";
import { plexConnection } from "./ai-collection-shared.ts";
import { WTYL_LABEL } from "./we-think-youd-like/index.ts";

export function createWtylRemoveCommand(deps: Pick<Services, "clients" | "collections" | "config">) {
  const { clients, collections, config } = deps;
  const { plexHealthCallback } = clients;
  const { getConfig } = config;
  const { forgetCollections } = collections;

  async function run(ctx: JobContext): Promise<void> {
    const { url, token } = plexConnection(getConfig);
    if (!token) throw new Error("Plex token is required. Configure it in Settings.");

    const client = createPlexClient({ url, token, signal: ctx.signal, onHealth: plexHealthCallback });
    ctx.log(`tinkerbell wtyl-remove`);
    ctx.log(`Server: ${url}`);

    const sections = await client.getSections();
    let total = 0;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      ctx.progress(i, sections.length, `Scanning "${section.title}"...`);
      const deleted = await client.deleteCollectionsByLabel(section.key, WTYL_LABEL);
      // The cache rows too, or the Collections page keeps listing them.
      forgetCollections(deleted);
      if (deleted.length > 0) ctx.log(`Deleted ${deleted.length} collection(s) in "${section.title}".`);
      total += deleted.length;
    }
    ctx.log(`Deleted ${total} We Think You'd Like collection(s).`);
  }

  return { run };
}

export default function run(ctx: JobContext): Promise<void> {
  return createWtylRemoveCommand(ctx.scope.resolve(ServicesToken)).run(ctx);
}
