import { ServicesToken, type Services } from "@rube/composition";
import { createPlexClient } from "@rube/plex";

import type { JobContext, CommonJobConfig } from "@rube/core";

export function createLabelUndoCommand(deps: Pick<Services, "clients" | "config">) {
  const { clients, config } = deps;
  const { plexHealthCallback } = clients;
  const { getConfig } = config;

  /**
   * Pure label hygiene: removes the `Rube` label from every item in the
   * configured sections and strips `User:*` labels from any collection.
   *
   * Does NOT touch sharing restrictions — those are managed by the BYW
   * lifecycle (the byw-remove job clears them on uninstall).
   */
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

    ctx.log(`rube label-undo`);
    ctx.log(`Server: ${PLEX_URL}`);

    const identity = await client.getIdentity();
    ctx.log(`Server name: ${identity.friendlyName}`);

    let sections = await client.getSections();
    const configuredLibraries = getConfig("global_plex_libraries");
    if (configuredLibraries) {
      sections = sections.filter((s) => configuredLibraries.includes(s.title));
    }
    if (config.sections && config.sections.length > 0) {
      sections = sections.filter((s) => config.sections!.includes(s.title));
    }

    // Phase 1: remove "Rube" label from all media items.
    ctx.log(`Removing "Rube" label from all media items...`);
    let totalUpdated = 0;
    for (const section of sections) {
      ctx.log(`Section: ${section.title} (${section.type})`);
      const updated = await client.removeLabelFromAllItems(section.key, section.type, "Rube", (current, total) => {
        ctx.progress(current, total, `Removing labels in "${section.title}"...`);
      });
      ctx.log(`Removed label from ${updated} item(s) in "${section.title}"`);
      totalUpdated += updated;
    }
    ctx.log(`Total items unlabelled: ${totalUpdated}`);

    // Phase 2: strip "User:" labels from collections.
    ctx.log(`Removing "User:" labels from collections...`);
    let collectionsUpdated = 0;
    for (const section of sections) {
      const colls = await client.getCollectionsWithLabels(section.key);
      for (const col of colls) {
        const userLabels = col.labels.filter((tag) => tag.startsWith("User:"));
        if (userLabels.length === 0) continue;
        const remaining = col.labels.filter((tag) => !tag.startsWith("User:"));
        await client.setCollectionLabels(section.key, col.ratingKey, remaining);
        ctx.log(`Removed ${userLabels.join(", ")} from "${col.title}"`);
        collectionsUpdated++;
      }
    }
    ctx.log(`Removed User labels from ${collectionsUpdated} collection(s)`);

    ctx.log(
      `Done — removed labels from ${totalUpdated} item(s) and User labels from ${collectionsUpdated} collection(s).`,
    );
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
  config: Parameters<ReturnType<typeof createLabelUndoCommand>["run"]>[1],
): Promise<void> {
  return createLabelUndoCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}
