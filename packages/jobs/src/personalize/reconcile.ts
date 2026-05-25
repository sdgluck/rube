import type { PlexClient } from "@tinkerbell/plex";
import { errorMessage, getConfig, setConfig } from "@tinkerbell/core";
import { db, sharingRestrictionBackups } from "@tinkerbell/db";

export const BASELINE_LABEL = "Tinkerbell";

/**
 * Ensure every current shared user is restricted to `[Tinkerbell, User:<self>]`,
 * snapshotting each user's prior filters (once) so disable can restore them.
 * Idempotent — used both by the enable job and by sync-users so newly-shared
 * users get restricted automatically.
 */
export async function reconcileSharingRestrictions(
  client: PlexClient,
  machineId: string,
  log: (msg: string) => void = () => {},
): Promise<number> {
  const sharings = await client.getSharings(machineId);
  const details = await client.getSharedServerDetails(machineId);
  const detailFor = (userId: number) => details.find((d) => d.userId === userId);

  let configured = 0;
  for (const s of sharings) {
    const d = detailFor(s.userId);
    db.insert(sharingRestrictionBackups)
      .values({
        sharingId: s.id,
        userId: s.userId,
        username: s.username,
        filterMovies: d?.filterMovies ?? "",
        filterTelevision: d?.filterTelevision ?? "",
        capturedAt: Date.now(),
      })
      .onConflictDoNothing()
      .run();

    const expected = `label=${[BASELINE_LABEL, `User:${s.username}`].join("|")}`;
    if (d?.filterMovies === expected) continue; // already restricted

    try {
      await client.setSharingRestrictions(s.id, [BASELINE_LABEL, `User:${s.username}`]);
      configured++;
    } catch (err) {
      log(`Failed to restrict ${s.username}: ${errorMessage(err)}`);
    }
  }

  const prior = getConfig("global_personalized_sharing");
  if (prior?.status === "enabled") {
    setConfig("global_personalized_sharing", { ...prior, lastReconcileAt: Date.now() });
  }
  return configured;
}
