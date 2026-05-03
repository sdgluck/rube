import { createPlexClient } from "../clients/plex.ts";
import { getConfig } from "../lib/config.ts";
import { syncUsers } from "../domains/users.ts";
import type { JobContext, CommonJobConfig } from "../lib/job-context.ts";

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

  ctx.log(`tinkerbell sync-users`);
  ctx.log(`Server: ${PLEX_URL}`);

  const identity = await client.getIdentity();
  ctx.log(`Server name: ${identity.friendlyName}`);

  ctx.log(`Syncing users...`);
  const stats = await syncUsers(client);

  ctx.log(`Done! Synced ${stats.synced} user(s), removed ${stats.removed} stale.`);
}
