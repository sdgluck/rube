import { createPlexClient } from "../plex.ts";
import { getConfig } from "../config.ts";
import { syncMedia } from "../media.ts";
import type { JobContext, CommonJobConfig } from "../../shared/job-context.ts";

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
  });

  ctx.log(`tinkerbell sync-media`);
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
  ctx.log(`Syncing media items...`);

  const stats = await syncMedia(client, sections, (current, total, message) => {
    ctx.progress(current, total, message);
  });

  ctx.log(`Done! Synced ${stats.synced} item(s), removed ${stats.removed} stale.`);
}
