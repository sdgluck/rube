import { createPlexClient } from "../plex.ts";
import { getConfig } from "../config.ts";
import { syncSections } from "../sections.ts";
import type { JobContext, CommonJobConfig } from "../../shared/job-context.ts";

export default async function run(ctx: JobContext, _config: CommonJobConfig): Promise<void> {
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

  ctx.log("tinkerbell sync-sections");
  ctx.log(`Server: ${PLEX_URL}`);

  const identity = await client.getIdentity();
  ctx.log(`Server name: ${identity.friendlyName}`);

  ctx.progress(1, 1, "Syncing sections...");
  const stats = await syncSections(client);

  ctx.log(`Done! Synced ${stats.synced} section(s), removed ${stats.removed} stale.`);
}
