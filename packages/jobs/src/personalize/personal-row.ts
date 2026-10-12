/**
 * A row made for one person. Because You Watched, We Think You'd Like and
 * personalized rules all build them, and all three got the same two things
 * wrong:
 *
 *  - **Labels.** A shared user sees what passes their restriction,
 *    `label=Tinkerbell|User:<self>`, and Plex reads that `|` as OR. Every
 *    person's row also carried the baseline `Tinkerbell` label, so it passed
 *    every restricted user's filter and everyone could browse everyone's rows.
 *    A person's row carries their `User:` label and never the baseline.
 *  - **The pin.** `promotedToSharedHome: 0` is what Plex records as
 *    `homeVisibility: admin` — the owner's Home only. The row never reached the
 *    shared user it was made for, while the owner's Home collected everyone's.
 *    The pin follows the person instead: the owner's own Home, or the shared
 *    Home for anyone else, where their restriction keeps it theirs alone.
 */
import type { PinOptions, PlexClient } from "@tinkerbell/plex";
import { BASELINE_LABEL } from "./reconcile.ts";

/** The labels for a row made for `username`: the job's own, then whose it is. */
export function personalRowLabels(username: string, ...own: string[]): string[] {
  return [...own.filter((l) => l !== BASELINE_LABEL), `User:${username}`];
}

/** Whose Home a person's row is pinned to — see the header. */
export function personalRowPin(isOwner: boolean): PinOptions {
  return {
    promotedToOwnHome: isOwner ? 1 : 0,
    promotedToRecommendedHome: 1,
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
