import type { Services } from "@rube/composition";
import { errorMessage } from "@rube/core";
import type { PlexClient, PlexSection } from "@rube/plex";

import { BASELINE_LABEL } from "./reconcile.ts";

/**
 * Give new arrivals the personalization label.
 *
 * With personalization on, every shared user's filter is
 * `label=Rube,User:<them>`, so an item without the baseline label is
 * invisible to all of them. Only the enable job and its Reconcile button used
 * to label anything, and neither runs on a schedule, so every film and show
 * added after the last reconcile stayed hidden until someone noticed and
 * pressed the button.
 *
 * Two jobs call this. `sync-recently-added` (every 15 minutes) keeps the
 * label current. The nightly `sync-media` call is a backstop. `sync-media`
 * itself isn't run more often because it walks every library in full, and the
 * overnight chain is timed around it. Labelling alone is cheap:
 * `addLabelToAllItems` asks Plex for `label!=Rube`, so on an up-to-date
 * library it costs one empty listing per section.
 *
 * Skipped while enabling (that job is already labelling) and while disabling
 * (this would put back what it is taking off).
 *
 * Per-section failures are reported in the outcome, not thrown, so they don't
 * fail the job that called this. The next run picks up the stragglers through
 * the filter. An abort is the run ending, so it does propagate.
 */
export async function labelNewArrivals(
  deps: Pick<Services, "config">,
  client: PlexClient,
  sections: PlexSection[],
  signal?: AbortSignal,
): Promise<{ labelled: number; failed: number; message: string }> {
  const status = deps.config.getConfig("global_personalized_sharing")?.status ?? "disabled";
  if (status !== "enabled") {
    return { labelled: 0, failed: 0, message: `Personalization labels: skipped (personalization is ${status})` };
  }

  let labelled = 0;
  const failures: string[] = [];
  for (const section of sections) {
    try {
      labelled += await client.addLabelToAllItems(section.key, section.type, BASELINE_LABEL);
    } catch (err) {
      if (signal?.aborted) throw err;
      failures.push(`"${section.title}": ${errorMessage(err)}`);
    }
  }

  const outcome =
    labelled > 0
      ? `${labelled} new item(s) labelled "${BASELINE_LABEL}" so shared users can see them`
      : failures.length > 0
        ? "nothing labelled"
        : "all items already labelled";
  const failed = failures.length > 0 ? `; failed for ${failures.join(", ")}` : "";
  return { labelled, failed: failures.length, message: `Personalization labels: ${outcome}${failed}` };
}
