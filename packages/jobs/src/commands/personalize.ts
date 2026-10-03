import { ServicesToken, type Services } from "@tinkerbell/composition";
import { createDispatchCommand } from "./generate/dispatch.ts";
import { createPlexClient, type PlexSection } from "@tinkerbell/plex";
import { errorMessage } from "@tinkerbell/core";

import { meetsPinFloor } from "./generate/rotation.ts";
import { parseRuleConfig } from "./generate/config.ts";
import type { JobContext, PersonalizeJobConfig } from "@tinkerbell/core";
import { isNarrowed, removeOutOfTarget, selectTargets, type TargetScope } from "../personalize/targets.ts";

const BASELINE_LABEL = "Tinkerbell";

function filterSectionsForRule(all: PlexSection[], ruleSections: string[] | undefined): PlexSection[] {
  if (!ruleSections?.length) return all;
  const names = ruleSections.map((s) => s.trim().toLowerCase());
  return all.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
}

export function createPersonalizeCommand(deps: Services) {
  const { clients, collections, config, preferences, rules } = deps;
  const { plexHealthCallback } = clients;
  const { getConfig, getPersonalizedSharingStatus } = config;
  const { listOptedInUserPreferences } = preferences;
  const { getEnabledRules } = rules;
  const { upsertCollectionByKey, forgetCollections } = collections;
  const { handlerForRule } = createDispatchCommand(deps);

  /**
   * Per-user personalization pass. For each opted-in user, re-runs every rule
   * the admin flagged `personalizable`, scoped to that user's preferences, and
   * commits the result as a `User:<name>`-labelled collection pinned to their
   * home. Requires the personalization master switch to be enabled (that's what
   * keeps each collection visible only to its owner).
   */
  async function run(ctx: JobContext, config: PersonalizeJobConfig): Promise<void> {
    if (getPersonalizedSharingStatus() !== "enabled") {
      throw new Error("Personalized Home Screens must be enabled first (Settings → Personalization).");
    }

    const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
    const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
    if (!PLEX_TOKEN) throw new Error("Plex token is required. Configure it in Settings.");

    const optedIn = listOptedInUserPreferences();
    if (optedIn.length === 0) {
      ctx.log("No opted-in users — nothing to personalize.");
      return;
    }

    const personalizable = getEnabledRules().filter((r) => parseRuleConfig(r).personalizable);
    if (personalizable.length === 0) {
      ctx.log("No rules are marked personalizable — nothing to do.");
      return;
    }

    const targets = selectTargets(optedIn, personalizable, config);
    for (const name of targets.notOptedIn) {
      ctx.log(`Skipping ${name} — targeted, but hasn't opted in through the portal.`);
    }
    for (const id of targets.unknownRules) {
      ctx.log(`Skipping rule ${id} — targeted, but it isn't an enabled personalizable rule.`);
    }
    const users = targets.users;
    const rules = targets.rules;
    const scope: TargetScope = {
      optedIn: new Set(optedIn.map((u) => u.username.toLowerCase())),
      personalizable: new Set(personalizable.map((r) => r.id)),
      targetUsers: new Set(users.map((u) => u.username.toLowerCase())),
      targetRules: new Set(rules.map((r) => r.id)),
    };

    const client = createPlexClient({
      url: PLEX_URL,
      token: PLEX_TOKEN,
      signal: ctx.signal,
      onHealth: plexHealthCallback,
    });
    const identity = await client.getIdentity();
    const machineId = identity.machineIdentifier;

    let allSections = await client.getSections();
    const configuredLibraries = getConfig("global_plex_libraries");
    if (configuredLibraries) allSections = allSections.filter((s) => configuredLibraries.includes(s.title));
    if (config.sections?.length) allSections = allSections.filter((s) => config.sections!.includes(s.title));

    // Before building, so a user dropped from the target loses their rows on
    // this run rather than keeping them pinned until someone notices.
    if (isNarrowed(scope)) {
      const removed = await removeOutOfTarget(client, allSections, scope, ctx);
      if (removed.length > 0) forgetCollections(removed);
    }

    if (users.length === 0 || rules.length === 0) {
      ctx.log("Nothing left to personalize after targeting.");
      return;
    }
    ctx.log(`Personalizing ${rules.length} rule(s) for ${users.length} user(s).`);

    const total = users.length * rules.length;
    let step = 0;

    for (const user of users) {
      const userLabel = `User:${user.username}`;
      const excluded = new Set(user.preferences.excludedTitles.map((t) => t.toLowerCase()));
      // Rows this person has said aren't for them, from the portal's "Not for me".
      const excludedRows = new Set(user.preferences.excludedCollections.map((t) => t.toLowerCase()));
      const rowCap = user.preferences.rowCount ?? Infinity;
      let rowsCreated = 0;

      for (const rule of rules) {
        step++;
        ctx.progress(step, total, `"${rule.name}" for ${user.username}...`);
        if (rowsCreated >= rowCap) {
          ctx.log(`Reached row cap (${rowCap}) for ${user.username}.`);
          break;
        }

        const ruleConfig = parseRuleConfig(rule);
        const pinMinItems = ruleConfig.pinMinItems ?? 0;
        const ruleLabel = `Rule:${rule.id}`;
        const sections = filterSectionsForRule(allSections, ruleConfig.sections);
        if (sections.length === 0) continue;

        const handler = handlerForRule(rule.type);
        if (!handler) {
          ctx.log(`No handler for rule type "${rule.type}", skipping.`);
          continue;
        }

        // Replace this user's prior collections for this rule before regenerating.
        await deleteUserRuleCollections(client, sections, userLabel, ruleLabel, ctx);

        try {
          for await (const pending of handler({
            ctx,
            client,
            sections,
            rule,
            ruleConfig,
            userPrefs: user.preferences,
          })) {
            if (rowsCreated >= rowCap) break;
            if (excludedRows.has(pending.name.toLowerCase())) {
              ctx.log(`Skipped "${pending.name}" for ${user.username} — they said it wasn't for them.`);
              continue;
            }
            const matched = pending.matched.filter((m) => !excluded.has(m.title.toLowerCase()));
            if (matched.length === 0) continue;

            // Every collection this job creates exists to be a row on one
            // person's home, so the rule's pin floor decides whether it's built
            // at all — unlike the shared pass, where an unpinned collection is
            // still worth having in the library. Excluded titles are already
            // out of `matched`, so a user who hid enough of a shelf loses it.
            if (!meetsPinFloor(matched.length, pinMinItems)) {
              ctx.log(
                `Skipped "${pending.name}" for ${user.username} — ${matched.length} item(s), floor is ${pinMinItems}.`,
              );
              continue;
            }

            const key = await client.createCollectionWithLabel(
              pending.section.key,
              pending.section.type,
              machineId,
              pending.name,
              matched.map((m) => m.ratingKey),
              [BASELINE_LABEL, userLabel, ruleLabel],
            );
            if (!key) continue;

            await client.pinToHomepage(pending.section.key, key, {
              promotedToOwnHome: 1,
              promotedToRecommendedHome: 1,
              promotedToSharedHome: 0,
            });
            try {
              await upsertCollectionByKey(client, pending.section, key);
            } catch (err) {
              ctx.log(`Failed to sync "${pending.name}" to local DB: ${errorMessage(err)}`);
            }
            rowsCreated++;
            ctx.log(`Created "${pending.name}" for ${user.username} (${matched.length} items).`);
          }
        } catch (err) {
          ctx.log(`Rule "${rule.name}" failed for ${user.username}: ${errorMessage(err)}`);
        }
      }
      ctx.log(`${user.username}: ${rowsCreated} personalized collection(s).`);
    }

    ctx.log("All done!");
  }

  async function deleteUserRuleCollections(
    client: ReturnType<typeof createPlexClient>,
    sections: PlexSection[],
    userLabel: string,
    ruleLabel: string,
    ctx: JobContext,
  ): Promise<void> {
    for (const section of sections) {
      // Narrowed to this user's collections server-side; both labels are still
      // checked below, since the rule label is what makes one of them stale.
      const collections = await client.getCollectionsWithLabels(section.key, { label: userLabel });
      for (const col of collections) {
        const tags = col.labels;
        if (tags.includes(userLabel) && tags.includes(ruleLabel)) {
          await client.deleteItem(col.ratingKey);
          forgetCollections([col.ratingKey]);
          ctx.log(`Removed stale "${col.title}".`);
        }
      }
    }
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
  config: Parameters<ReturnType<typeof createPersonalizeCommand>["run"]>[1],
): Promise<void> {
  return createPersonalizeCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}
