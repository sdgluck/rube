/**
 * A row made for one person. Because You Watched, We Think You'd Like and
 * personalized rules all build them, and all three got the same two things
 * wrong:
 *
 *  - **Labels.** A shared user sees what passes their restriction,
 *    `label=Rube,User:<self>` — either label. Every person's row also
 *    carried the baseline `Rube` label, so it passed every restricted
 *    user's filter and everyone could browse everyone's rows. A person's row
 *    carries their `User:` label and never the baseline. (The restriction
 *    itself was also miswritten with `|` until 2026-10, which admitted only
 *    `Rube` — see `clients/plex/src/filters.ts`.)
 *  - **The pin.** `promotedToSharedHome: 0` is what Plex records as
 *    `homeVisibility: admin` — the owner's Home only. The row never reached the
 *    shared user it was made for, while the owner's Home collected everyone's.
 *    The pin follows the person instead: the owner's own Home, or the shared
 *    Home for anyone else, where their restriction keeps it theirs alone.
 *  - **Recommended.** A library's Recommended tab is one list for everyone,
 *    and label restrictions never apply to the owner, so every person's row
 *    showed there for the owner: 116 of 131 rows on one server's Films tab.
 *    A shared user's row stays off Recommended. They lose it from their own
 *    Recommended tab too, since Plex has no per-viewer flag, but their Home is
 *    where the row is meant to be. (Until 2026-10 the flag was sent as
 *    `promotedToRecommendedHome`, which Plex ignores, so it stayed on.)
 */
import type { PinOptions, PlexClient } from "@rube/plex";
import { BASELINE_LABEL } from "./reconcile.ts";

/** The labels for a row made for `username`: the job's own, then whose it is. */
export function personalRowLabels(username: string, ...own: string[]): string[] {
  return [...own.filter((l) => l !== BASELINE_LABEL), `User:${username}`];
}

/** Whose Home a person's row is pinned to — see the header. */
export function personalRowPin(isOwner: boolean): PinOptions {
  return {
    promotedToOwnHome: isOwner ? 1 : 0,
    promotedToRecommended: isOwner ? 1 : 0,
    promotedToSharedHome: isOwner ? 0 : 1,
  };
}

/**
 * Bring a row made before the above into line: drop the baseline label, and
 * re-pin it if the job pins. Rows that are kept or edited in place would
 * otherwise stay visible to everyone and missing from their owner's Home
 * forever. A no-op on a row without the baseline label, so the re-pin happens
 * once and doesn't undo where the person has since moved it.
 */
export async function repairPersonalRow(
  client: Pick<PlexClient, "setCollectionLabels" | "pinToHomepage">,
  sectionId: string,
  row: { ratingKey: string; labels: string[] },
  opts: { isOwner: boolean; pin: boolean },
): Promise<boolean> {
  if (!row.labels.includes(BASELINE_LABEL)) return false;
  // The full remaining list: on a single item Plex replaces the label set,
  // and the `tag-` removal form strips every label, not just the one named.
  const labels = row.labels.filter((l) => l !== BASELINE_LABEL);
  await client.setCollectionLabels(sectionId, row.ratingKey, labels);
  row.labels = labels;
  if (opts.pin) await client.pinToHomepage(sectionId, row.ratingKey, personalRowPin(opts.isOwner));
  return true;
}

/**
 * Take shared users' rows in `sectionId` off Recommended, leaving their Home
 * settings as they are. Rows are pinned only when they are made, so this is
 * what moves the rows that already exist, and the ones pinned before the flag
 * was spelled right. Only the owner can change the flag, in Plex's Manage
 * Recommendations, so this never undoes a choice made by the person the row is
 * for. Returns how many it changed.
 */
export async function keepOffRecommended(
  client: Pick<PlexClient, "getManagedHubs" | "pinToHomepage">,
  sectionId: string,
  sharedUsersRows: ReadonlySet<string>,
): Promise<number> {
  if (sharedUsersRows.size === 0) return 0;
  let moved = 0;
  for (const hub of await client.getManagedHubs(sectionId)) {
    const ratingKey = hub.identifier.split(".").pop() ?? "";
    if (!sharedUsersRows.has(ratingKey) || !hub.promotedToRecommended) continue;
    await client.pinToHomepage(sectionId, ratingKey, {
      promotedToOwnHome: hub.promotedToOwnHome ?? 0,
      promotedToRecommended: 0,
      promotedToSharedHome: hub.promotedToSharedHome ?? 0,
    });
    moved++;
  }
  return moved;
}
