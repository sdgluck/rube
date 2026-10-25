import { ServicesToken, type Services } from "@rube/composition";
import { createPlexClient } from "@rube/plex";

import { shuffleSectionHubs } from "@rube/domain.shuffle-hubs";
import { createHubOrder } from "../hub-order.ts";
import type { JobContext, CommonJobConfig } from "@rube/core";

export function createShuffleCommand(deps: Pick<Services, "clients" | "config" | "db" | "rules">) {
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

    ctx.log(`rube shuffle`);
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

    const keepFirst = createHubOrder(deps).topPinnedRatingKeys();
    if (keepFirst.size > 0) ctx.log(`Keeping ${keepFirst.size} collection(s) at the top.`);

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      ctx.progress(i + 1, sections.length, `Shuffling "${section.title}"...`);
      await shuffleSectionHubs(client, section, ctx.log, { keepFirst });
    }

    ctx.log("All done!");
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
  config: Parameters<ReturnType<typeof createShuffleCommand>["run"]>[1],
): Promise<void> {
  return createShuffleCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}
