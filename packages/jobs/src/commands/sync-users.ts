import { createPlexClient } from "@tinkerbell/plex";
import { plexHealthCallback } from "@tinkerbell/core";
import { getConfig, getPersonalizedSharingStatus } from "@tinkerbell/core";
import { syncUsers } from "@tinkerbell/domain.users";
import { reconcileSharingRestrictions } from "#jobs/personalize/reconcile.ts";
import type { JobContext, CommonJobConfig } from "@tinkerbell/core";

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
    onHealth: plexHealthCallback,
  });

  ctx.log(`tinkerbell sync-users`);
  ctx.log(`Server: ${PLEX_URL}`);

  const identity = await client.getIdentity();
  ctx.log(`Server name: ${identity.friendlyName}`);

  ctx.log(`Syncing users...`);
  const stats = await syncUsers(client);
  ctx.log(`Synced ${stats.synced} user(s), removed ${stats.removed} stale.`);

  // When personalization is on, make sure any newly-shared users are
  // restricted to their own content so per-user collections stay private.
  if (getPersonalizedSharingStatus() === "enabled") {
    ctx.log(`Reconciling sharing restrictions...`);
    const restricted = await reconcileSharingRestrictions(client, identity.machineIdentifier, ctx.log);
    ctx.log(`Reconciled — restricted ${restricted} user(s) that needed it.`);
  }

  ctx.log(`Done!`);
}
