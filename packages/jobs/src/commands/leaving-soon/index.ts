/**
 * Leaving Soon: one row per library of what cleanup is about to delete.
 *
 * The cleanup queue already warns people — in the portal's Leaving Soon tab
 * and in the digest — but only people who go and look. A row on Home is the
 * warning that reaches someone halfway through deciding what to watch, which
 * is the moment a "last chance" is worth anything.
 *
 * Choices, each for a failure the obvious version has:
 *
 *  - **The queue's own answer, not a second one.** What is "leaving" comes
 *    from `cleanup.leavingSoon`, the same predicate the portal and the digest
 *    use: destructive modes only, and only items the engine would actually
 *    act on (rule on, not held, not protected, approved where it must be, and
 *    cleanup switched on). A row that disagreed with the queue page would be
 *    a row promising deletions that never come.
 *  - **One row for everyone.** What a cleanup rule deletes is the same for
 *    every viewer, so there is nothing to personalize — and it needs no
 *    Personalized Home Screens.
 *  - **Edited in place, removed when empty.** Items deleted overnight leave
 *    the queue and so leave the row on the next run; an empty "Leaving Soon"
 *    on Home is noise.
 *  - **A title of its own** (`jobRowTitle`), so it never pools its items with
 *    a "Leaving Soon" collection someone made by hand.
 */
import { LEAVING_DEFAULTS } from "@rube/contracts";
import { ServicesToken, type Services } from "@rube/composition";
import { displayTitle, errorMessage, jobRowTitle } from "@rube/core";
import type { JobContext, LeavingSoonJobConfig } from "@rube/core";
import { createPlexClient, type PinOptions, type PlexSection } from "@rube/plex";
import { ClockToken } from "@rube/ports";
import { plexConnection, resolveTargetSections } from "../ai-collection-shared.ts";
import { hasLabel } from "../../personalize/personal-row-writer.ts";
import { BASELINE_LABEL } from "../../personalize/reconcile.ts";

export const LEAVING_LABEL = "LeavingSoon";
export const LEAVING_ROW_NAME = "Leaving Soon";
/** Everyone's Home: what is leaving is leaving for everybody. */
const SHARED_PIN: PinOptions = { promotedToOwnHome: 1, promotedToRecommended: 1, promotedToSharedHome: 1 };

/** "goes tonight" / "within 3 days", from the furthest `runsRemaining` in the row. A streak counts days. */
export function leavingSummary(furthest: number): string {
  const when = furthest <= 0 ? "on the next cleanup run" : `within ${furthest + 1} days`;
  return `Cleanup removes these ${when}. Watch them before they go.`;
}

export function createLeavingSoonCommand(
  deps: Pick<Services, "cleanup" | "clients" | "collections" | "config">,
  opts: { now?: () => number } = {},
) {
  const { cleanup, clients, collections, config } = deps;
  const now = opts.now ?? Date.now;
  const { plexHealthCallback } = clients;
  const { getConfig } = config;
  const { forgetCollections, upsertCollectionByKey } = collections;

  async function run(ctx: JobContext, cfg: LeavingSoonJobConfig): Promise<void> {
    const { url, token } = plexConnection(getConfig);
    const withinRuns = cfg.withinRuns ?? LEAVING_DEFAULTS.withinRuns;
    const maxItems = cfg.maxItems ?? LEAVING_DEFAULTS.maxItems;
    const minItems = cfg.minItems ?? LEAVING_DEFAULTS.minItems;
    const pin = cfg.pinToHomepage ?? LEAVING_DEFAULTS.pinToHomepage;
    if (!token) throw new Error("Plex token is required. Configure it in Settings.");

    const client = createPlexClient({ url, token, signal: ctx.signal, onHealth: plexHealthCallback });
    ctx.log(`rube leaving-soon`);
    ctx.log(`Server: ${url}`);

    const refusal = cleanup.standingRefusal(now());
    if (refusal) ctx.log(`Cleanup won't remove anything right now — ${refusal} Any rows are taken down.`);
    // Everything the engine would act on, soonest first. Empty while cleanup
    // is refusing, which is what takes the rows down.
    const leaving = cleanup
      .leavingSoon(10_000, now())
      .filter((i) => i.runsRemaining <= withinRuns)
      .sort((a, b) => a.runsRemaining - b.runsRemaining || a.title.localeCompare(b.title));

    const sections = await resolveTargetSections(client, getConfig, cfg.sections);
    let machineId: string | undefined;
    for (const [i, section] of sections.entries()) {
      ctx.progress(i, sections.length, section.title);
      const rows = (await client.getCollectionsWithLabels(section.key, { label: LEAVING_LABEL })).filter((r) =>
        hasLabel(r, LEAVING_LABEL),
      );
      const mine = leaving.filter((item) => item.sectionId === section.key).slice(0, maxItems);
      const [existing, ...extra] = rows;
      // One row per library; a second is left from an earlier run that raced.
      for (const row of extra) await deleteRow(row.ratingKey, "a second copy");

      if (mine.length < minItems) {
        ctx.log(`"${section.title}": ${mine.length} title(s) leaving within ${withinRuns + 1} days; no row.`);
        if (existing) await deleteRow(existing.ratingKey, "nothing is leaving");
        continue;
      }
      ctx.log(
        `"${section.title}": ${mine.map((m) => `${m.title} (${m.runsRemaining === 0 ? "next run" : `${m.runsRemaining} more run(s)`})`).join("; ")}.`,
      );
      machineId ??= (await client.getIdentity()).machineIdentifier;
      await writeRow(
        section,
        existing,
        mine.map((m) => m.ratingKey),
        leavingSummary(Math.max(...mine.map((m) => m.runsRemaining))),
      );
    }
    ctx.progress(sections.length, sections.length, "Done");
    ctx.log("All done!");

    async function deleteRow(ratingKey: string, why: string): Promise<void> {
      ctx.log(`Deleting "${LEAVING_ROW_NAME}" (${ratingKey}) — ${why}.`);
      await client.deleteItem(ratingKey);
      forgetCollections([ratingKey]);
    }

    async function writeRow(
      section: PlexSection,
      existing: { ratingKey: string; title: string } | undefined,
      ratingKeys: string[],
      summary: string,
    ): Promise<void> {
      const title = jobRowTitle(LEAVING_ROW_NAME, "leaving-soon");
      let collectionKey: string;
      if (existing && existing.title === title) {
        collectionKey = existing.ratingKey;
        const current = (await client.getCollectionChildren(collectionKey, { smart: false })).map((c) => c.ratingKey);
        const wanted = new Set(ratingKeys);
        const have = new Set(current);
        const add = ratingKeys.filter((k) => !have.has(k));
        const remove = current.filter((k) => !wanted.has(k));
        await client.addCollectionItems(collectionKey, machineId!, add);
        for (const key of remove) await client.removeCollectionItem(collectionKey, key);
        await client.updateCollection(collectionKey, { summary });
        ctx.log(`Updated "${LEAVING_ROW_NAME}" in "${section.title}": ${add.length} added, ${remove.length} removed.`);
      } else {
        if (existing) await deleteRow(existing.ratingKey, `its title isn't "${displayTitle(title)}"`);
        const created = await client.createCollectionWithLabel(
          section.key,
          section.type,
          machineId!,
          title,
          ratingKeys,
          [BASELINE_LABEL, LEAVING_LABEL],
        );
        if (!created) return;
        collectionKey = created;
        await client.updateCollection(collectionKey, { summary });
        // Pinned on creation only, so a row someone moved stays where they put it.
        if (pin) await client.pinToHomepage(section.key, collectionKey, SHARED_PIN);
        ctx.log(`Created "${LEAVING_ROW_NAME}" in "${section.title}" (${ratingKeys.length} titles).`);
      }
      try {
        await upsertCollectionByKey(client, section, collectionKey);
      } catch (err) {
        ctx.log(`Failed to sync "${LEAVING_ROW_NAME}" to local DB: ${errorMessage(err)}`);
      }
    }
  }

  return { run };
}

/** The command entrypoint the runner and the Sidequest worker call. */
export default function run(ctx: JobContext, config: LeavingSoonJobConfig): Promise<void> {
  return createLeavingSoonCommand(ctx.scope.resolve(ServicesToken), { now: ctx.scope.resolve(ClockToken) }).run(
    ctx,
    config,
  );
}
