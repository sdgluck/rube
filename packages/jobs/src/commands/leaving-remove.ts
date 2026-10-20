/**
 * Tears down Leaving Soon: deletes every collection it labelled, in every
 * section — a library taken out of its settings since a row was made still
 * has the row in it. The cleanup queue itself is untouched; removing the row
 * changes nothing about what cleanup will delete.
 */
import { ServicesToken, type Services } from "@tinkerbell/composition";
import { createPlexClient } from "@tinkerbell/plex";
import type { JobContext } from "@tinkerbell/core";
import { plexConnection } from "./ai-collection-shared.ts";
import { LEAVING_LABEL } from "./leaving-soon/index.ts";

export function createLeavingRemoveCommand(deps: Pick<Services, "clients" | "collections" | "config">) {
  const { clients, collections, config } = deps;
  const { plexHealthCallback } = clients;
  const { getConfig } = config;
  const { forgetCollections } = collections;

  async function run(ctx: JobContext): Promise<void> {
    const { url, token } = plexConnection(getConfig);
    if (!token) throw new Error("Plex token is required. Configure it in Settings.");

    const client = createPlexClient({ url, token, signal: ctx.signal, onHealth: plexHealthCallback });
    ctx.log(`tinkerbell leaving-remove`);
    ctx.log(`Server: ${url}`);

    const sections = await client.getSections();
    let total = 0;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      ctx.progress(i, sections.length, `Scanning "${section.title}"...`);
      const deleted = await client.deleteCollectionsByLabel(section.key, LEAVING_LABEL);
      // The cache rows too, or the Collections page keeps listing them.
      forgetCollections(deleted);
      if (deleted.length > 0) ctx.log(`Deleted ${deleted.length} collection(s) in "${section.title}".`);
      total += deleted.length;
    }
    ctx.log(`Deleted ${total} Leaving Soon collection(s).`);
  }

  return { run };
}

export default function run(ctx: JobContext): Promise<void> {
  return createLeavingRemoveCommand(ctx.scope.resolve(ServicesToken)).run(ctx);
}
