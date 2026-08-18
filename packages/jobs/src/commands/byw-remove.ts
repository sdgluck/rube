import { ServicesToken, type Services } from "@tinkerbell/composition";
import { createPlexClient } from "@tinkerbell/plex";
import { errorMessage } from "@tinkerbell/core";

import type { JobContext, CommonJobConfig } from "@tinkerbell/core";

const BYW_LABEL = "BecauseYouWatched";

export function createBywRemoveCommand(deps: Pick<Services, "clients" | "collections" | "config">) {
  const { clients, collections, config } = deps;
  const { plexHealthCallback } = clients;
  const { getConfig } = config;
  const { forgetCollections } = collections;

  /**
   * Tear down all Because You Watched state on Plex:
   *   1. Delete every collection labelled "BecauseYouWatched" across configured sections.
   *   2. Clear the sharing restrictions on every shared user so they no longer see
   *      a stale Tinkerbell allow-list once the per-user collections are gone.
   *
   * Does NOT touch item-level Tinkerbell labels — those are managed by the
   * separate "Clear Tinkerbell Labels" job.
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

    ctx.log(`tinkerbell byw-remove`);
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

    // Phase 1: delete BYW collections.
    ctx.log(`Deleting Because You Watched collections...`);
    let totalDeleted = 0;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      ctx.progress(i, sections.length, `Scanning "${section.title}"...`);
      const deleted = await client.deleteCollectionsByLabel(section.key, BYW_LABEL);
      // Drop the cache rows too, or the Collections page keeps listing BYW
      // collections that are no longer on the server.
      forgetCollections(deleted);
      if (deleted.length > 0) {
        ctx.log(`Deleted ${deleted.length} BYW collection(s) in "${section.title}"`);
      }
      totalDeleted += deleted.length;
    }
    ctx.log(`Deleted ${totalDeleted} BYW collection(s) total.`);

    // Phase 2: clear sharing restrictions on every shared user.
    ctx.log(`Clearing sharing restrictions for shared users...`);
    const sharings = await client.getSharings(identity.machineIdentifier);

    if (sharings.length === 0) {
      ctx.log(`No shared users found.`);
      ctx.log(`Done — deleted ${totalDeleted} collection(s); no users to update.`);
      return;
    }

    let cleared = 0;
    for (let i = 0; i < sharings.length; i++) {
      const sharing = sharings[i];
      ctx.progress(i + 1, sharings.length, `Clearing restrictions for "${sharing.username}"...`);
      try {
        await client.clearSharingRestrictions(sharing.id);
        ctx.log(`Cleared restrictions for ${sharing.username}`);
        cleared++;
      } catch (err) {
        ctx.log(`Failed to clear restrictions for ${sharing.username}: ${errorMessage(err)}`);
      }
    }

    ctx.log(
      `Done — deleted ${totalDeleted} collection(s), cleared restrictions for ${cleared}/${sharings.length} user(s).`,
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
  config: Parameters<ReturnType<typeof createBywRemoveCommand>["run"]>[1],
): Promise<void> {
  return createBywRemoveCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}
