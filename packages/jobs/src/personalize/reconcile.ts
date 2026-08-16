import type { PlexClient } from "@tinkerbell/plex";
import { getFilterClause } from "@tinkerbell/plex";
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

    // Compare the label clause alone. The same string can also carry a
    // `contentRating=` clause an admin set on the user's detail page, and
    // testing the whole string would read that as drift and wipe it on every
    // run — which is how a parental rating silently disappears.
    const expected = [BASELINE_LABEL, `User:${s.username}`];
    const actual = getFilterClause(d?.filterMovies, "label");
    if (actual.length === expected.length && expected.every((l) => actual.includes(l))) continue;

    try {
      await client.setSharingRestrictions(s.id, expected, d);
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
