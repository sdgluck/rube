import { ServicesToken, type Services } from "@tinkerbell/composition";
import { createPlexClient } from "@tinkerbell/plex";

import type { JobContext, CommonJobConfig } from "@tinkerbell/core";

export function createSyncCollectionsCommand(deps: Pick<Services, "clients" | "collections" | "config">) {
  const { clients, collections, config } = deps;
  const { plexHealthCallback } = clients;
  const { getConfig } = config;
  const { syncCollections } = collections;

  async function run(ctx: JobContext, config: CommonJobConfig): Promise<void> {
    const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
    const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;

    if (!PLEX_TOKEN) {
      throw new Error("Plex token is required. Configure it in Settings.");
    }

    const client = createPlexClient({
      url: PLEX_URL,
      token: PLEX_TOKEN,
      signal: ctx.signal,
      onHealth: plexHealthCallback,
    });

    ctx.log(`tinkerbell sync-collections`);
    ctx.log(`Server: ${PLEX_URL}`);

    const identity = await client.getIdentity();
    ctx.log(`Server name: ${identity.friendlyName}`);

    let allSections = await client.getSections();

    const configuredLibraries = getConfig("global_plex_libraries");
    if (configuredLibraries) {
      allSections = allSections.filter((s) => configuredLibraries.includes(s.title));
    }

    let sections;
    if (config.sections && config.sections.length > 0) {
      const names = config.sections.map((s) => s.trim().toLowerCase());
      sections = allSections.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
      if (sections.length === 0) {
        throw new Error(`No matching sections found for "${config.sections.join(", ")}".`);
      }
    } else {
      sections = allSections;
    }

    ctx.log(`Sections: ${sections.map((s) => s.title).join(", ")}`);
    ctx.log(`Syncing collections...`);

    const stats = await syncCollections(
      client,
      sections,
      (current, total, message) => {
        ctx.progress(current, total, message);
      },
      // As in `sync-media`: the sweep must not delete the rows of a library this
      // run wasn't asked to look at. Cleanup protections resolve through them.
      { knownSectionKeys: allSections.map((s) => s.key) },
    );

    ctx.log(`Done! Synced ${stats.synced} collection(s), removed ${stats.removed} stale.`);
  }

  return { run };
}

/**
 * The command entrypoint, unchanged in shape: the runner and the Sidequest
 * worker both still call `default(ctx, config)`. What changed is where the
 * work gets its dependencies — the run's own container scope, rather than
 * whatever the module graph happened to have initialised.
 */
export default function run(
  ctx: JobContext,
  config: Parameters<ReturnType<typeof createSyncCollectionsCommand>["run"]>[1],
): Promise<void> {
  return createSyncCollectionsCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}
