import { createPlexClient } from "@tinkerbell/plex";
import { plexHealthCallback } from "#lib/clients.ts";
import { getConfig } from "#lib/config.ts";
import { shuffleSectionHubs } from "#domains/shuffle-hubs.ts";
import type { JobContext, CommonJobConfig } from "#lib/job-context.ts";

export default async function run(ctx: JobContext, config: CommonJobConfig): Promise<void> {
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

  ctx.log(`tinkerbell shuffle`);
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

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    ctx.progress(i + 1, sections.length, `Shuffling "${section.title}"...`);
    await shuffleSectionHubs(client, section, ctx.log);
  }

  ctx.log("All done!");
}
