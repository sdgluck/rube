import { ServicesToken, type Services } from "@tinkerbell/composition";
import { createPlexClient } from "@tinkerbell/plex";

import { errorMessage } from "@tinkerbell/core";

import type { JobContext, CommonJobConfig } from "@tinkerbell/core";

export function createLabelCommand(deps: Pick<Services, "clients" | "config">) {
  const { clients, config } = deps;
  const { plexHealthCallback } = clients;
  const { getConfig } = config;

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

    ctx.log(`tinkerbell label`);
    ctx.log(`Server: ${PLEX_URL}`);

    let machineId: string;
    const identity = await client.getIdentity();
    machineId = identity.machineIdentifier;
    ctx.log(`Server name: ${identity.friendlyName}`);

    // Get configured library sections
    let sections = await client.getSections();
    const configuredLibraries = getConfig("global_plex_libraries");
    if (configuredLibraries) {
      sections = sections.filter((s) => configuredLibraries.includes(s.title));
    }

    if (config.sections && config.sections.length > 0) {
      sections = sections.filter((s) => config.sections!.includes(s.title));
    }

    // Phase 1: Add "Tinkerbell" label to all media items
    ctx.log(`Adding "Tinkerbell" label to all media items...`);
    let totalUpdated = 0;
    for (const section of sections) {
      ctx.log(`Section: ${section.title} (${section.type})`);
      const updated = await client.addLabelToAllItems(section.key, section.type, "Tinkerbell", (current, total) => {
        ctx.progress(current, total, `Labelling items in "${section.title}"...`);
      });
      ctx.log(`Updated ${updated} item(s) in "${section.title}"`);
      totalUpdated += updated;
    }
    ctx.log(`Total items labelled: ${totalUpdated}`);

    // Phase 2: Configure user sharing restrictions
    ctx.log(`Fetching shared users from plex.tv...`);
    const sharings = await client.getSharings(machineId);
    // Read the current filters so the label rewrite below preserves any
    // content-rating clause set on the user's detail page.
    const details = await client.getSharedServerDetails(machineId).catch(() => []);

    if (sharings.length === 0) {
      ctx.log(`No shared users found for this server.`);
      ctx.log(`Done — labelled ${totalUpdated} item(s), no users to configure.`);
      return;
    }

    ctx.log(`Found ${sharings.length} shared user(s):`);
    for (const sharing of sharings) {
      ctx.log(`  ${sharing.username} (ID: ${sharing.userId})`);
    }

    let configured = 0;
    for (const sharing of sharings) {
      ctx.progress(sharings.indexOf(sharing) + 1, sharings.length, `Configuring "${sharing.username}"...`);

      const labels = ["Tinkerbell", `User:${sharing.username}`];
      ctx.log(`Configuring ${sharing.username}...`);
      ctx.log(`Labels: ${labels.join(", ")}`);

      try {
        await client.setSharingRestrictions(
          sharing.id,
          labels,
          details.find((d) => d.userId === sharing.userId),
        );
        ctx.log(`Set sharing restriction for ${sharing.username}`);
        configured++;
      } catch (err) {
        ctx.log(`Failed to set restriction for ${sharing.username}: ${errorMessage(err)}`);
      }
    }

    ctx.log(`Done — labelled ${totalUpdated} item(s), configured ${configured}/${sharings.length} user(s).`);
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
  config: Parameters<ReturnType<typeof createLabelCommand>["run"]>[1],
): Promise<void> {
  return createLabelCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}
