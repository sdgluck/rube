/**
 * Tears down Finish the Franchise: deletes every collection it labelled, in every
 * section — a library taken out of its settings since a row was made still
 * has the row in it. Like `pibu-remove`, it leaves sharing restrictions alone:
 * they belong to Personalized Home Screens, still on for the other personal rows.
 */
import { ServicesToken, type Services } from "@tinkerbell/composition";
import { createPlexClient } from "@tinkerbell/plex";
import type { JobContext } from "@tinkerbell/core";
import { plexConnection } from "./ai-collection-shared.ts";
import { FRANCHISE_LABEL } from "./finish-the-franchise/index.ts";

export function createFranchiseRemoveCommand(deps: Pick<Services, "clients" | "collections" | "config">) {
  const { clients, collections, config } = deps;
  const { plexHealthCallback } = clients;
  const { getConfig } = config;
  const { forgetCollections } = collections;

  async function run(ctx: JobContext): Promise<void> {
    const { url, token } = plexConnection(getConfig);
    if (!token) throw new Error("Plex token is required. Configure it in Settings.");

    const client = createPlexClient({ url, token, signal: ctx.signal, onHealth: plexHealthCallback });
    ctx.log(`tinkerbell franchise-remove`);
    ctx.log(`Server: ${url}`);

    const sections = await client.getSections();
    let total = 0;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      ctx.progress(i, sections.length, `Scanning "${section.title}"...`);
      const deleted = await client.deleteCollectionsByLabel(section.key, FRANCHISE_LABEL);
      // The cache rows too, or the Collections page keeps listing them.
      forgetCollections(deleted);
      if (deleted.length > 0) ctx.log(`Deleted ${deleted.length} collection(s) in "${section.title}".`);
      total += deleted.length;
    }
    ctx.log(`Deleted ${total} Finish the Franchise collection(s).`);
  }

  return { run };
}

export default function run(ctx: JobContext): Promise<void> {
  return createFranchiseRemoveCommand(ctx.scope.resolve(ServicesToken)).run(ctx);
}
