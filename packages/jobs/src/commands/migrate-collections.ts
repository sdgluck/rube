import { ServicesToken, type Services } from "@rube/composition";
import { createPlexClient } from "@rube/plex";
import { ruleConfigSchema } from "@rube/contracts";
import { badgeStyleSchema, conditionalRuleSchema, overlayPositionSchema, overlayTypeSchema } from "@rube/overlays";

import type { CommonJobConfig, JobContext } from "@rube/core";

function dedupeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function createMigrateCollectionsCommand(
  deps: Pick<Services, "clients" | "collections" | "config" | "metadataOverrides" | "migration" | "overlays" | "rules">,
) {
  const {
    clients,
    collections,
    config,
    metadataOverrides: metadataOverridesDomain,
    migration,
    overlays: overlaysDomain,
    rules,
  } = deps;
  const { plexHealthCallback } = clients;
  const { deleteConfig, getConfig, setConfig } = config;
  const { createRule, getRules } = rules;
  const { forgetCollections } = collections;
  const { markProviderCompleted, scanProviderState } = migration;
  const { upsertOverrides } = metadataOverridesDomain;
  const { replaceOverlayConfigs } = overlaysDomain;

  async function run(ctx: JobContext, _config: CommonJobConfig): Promise<void> {
    ctx.log("rube migrate-collections");

    const pending = getConfig("migration_pending_plan");
    if (!pending) {
      ctx.log("No pending migration plan found — aborting.");
      return;
    }

    const { providerId, items, deleteOriginals, overlays = [], metadataOverrides = [] } = pending;
    ctx.log(`Plan: provider=${providerId}, ${items.length} rule(s), deleteOriginals=${deleteOriginals}`);

    const totalSteps = items.length + (deleteOriginals ? items.length : 0);
    let step = 0;

    // 1. Create rules (disabled by default per the migration design)
    //
    // Names are suffixed on collision, the way registry import and the Rules
    // page's own duplicate action do it. A migrated rule landing under a name
    // that already exists is otherwise invisible: two rows reading identically,
    // distinguishable only by one of them being switched off.
    const taken = new Set(getRules().map((r) => r.name));
    /** Items whose rule actually landed — the only ones safe to delete originals for. */
    const created: typeof items = [];
    /** rule id ↔ what it replaced, so the migration can be verified afterwards. */
    const outcome: Array<{ ruleId: string; ruleName: string; replacesRatingKeys: string[] }> = [];
    const rejected: Array<{ ruleName: string; reason: string }> = [];
    for (const item of items) {
      ctx.signal?.throwIfAborted();
      step++;
      ctx.progress(step, totalSteps, `Creating rule "${item.ruleName}"...`);

      // Validate before creating. The YAML importer builds configs from a
      // mapping table rather than from the wizard, so a mapping bug reaches
      // here as a config no handler can run. Rejecting the one item beats
      // either throwing (which strands the rules already created, with the
      // pending plan still set and the run un-resumable) or writing it anyway
      // (which lands a rule that fails at 2am with no trace back to here).
      const parsed = ruleConfigSchema.safeParse(item.ruleConfig);
      if (!parsed.success) {
        const reason = parsed.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`).join("; ");
        rejected.push({ ruleName: item.ruleName, reason });
        ctx.log(`Skipped "${item.ruleName}" — invalid config (${reason}).`);
        continue;
      }

      const name = dedupeName(item.ruleName, taken);
      taken.add(name);
      const enabled = item.enabled ?? false;
      const rule = createRule({
        name,
        type: item.ruleType,
        config: item.ruleConfig,
        enabled,
      });
      created.push(item);
      outcome.push({ ruleId: rule.id, ruleName: rule.name, replacesRatingKeys: item.replacesRatingKeys });
      if (name !== item.ruleName) ctx.log(`"${item.ruleName}" already exists — migrated rule named "${name}".`);
      ctx.log(`Created rule "${rule.name}" (${rule.type}, id=${rule.id}, ${enabled ? "enabled" : "disabled"}).`);
    }
    if (rejected.length > 0) {
      ctx.log(`${rejected.length} rule(s) skipped as invalid: ${rejected.map((r) => r.ruleName).join(", ")}.`);
    }

    // 2. Optionally delete the original Plex collections this migration is
    // replacing. We delete the *specific* rating keys the plan pinned, not a
    // blanket label sweep, so untouched collections (e.g. unmappable ones the
    // user kept) survive.
    //
    // Only for items whose rule was actually created: deleting the originals
    // behind a rule that failed validation would destroy the collection and
    // leave nothing to rebuild it.
    if (deleteOriginals) {
      const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
      const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
      if (!PLEX_TOKEN) {
        ctx.log("Plex token missing — skipping originals delete.");
      } else {
        const client = createPlexClient({
          url: PLEX_URL,
          token: PLEX_TOKEN,
          signal: ctx.signal,
          onHealth: plexHealthCallback,
        });

        let deleted = 0;
        let failed = 0;
        for (const item of created) {
          ctx.signal?.throwIfAborted();
          step++;
          ctx.progress(step, totalSteps, `Deleting originals for "${item.ruleName}"...`);
          for (const ratingKey of item.replacesRatingKeys) {
            try {
              await client.deleteItem(ratingKey);
              forgetCollections([ratingKey]);
              deleted++;
            } catch (err) {
              failed++;
              ctx.log(`Failed to delete collection ratingKey=${ratingKey}: ${(err as Error).message ?? err}`);
            }
          }
        }
        ctx.log(`Deleted ${deleted} original collection(s)${failed ? `, ${failed} failed` : ""}.`);
      }
    }

    // 3. Rebuild the overlay layout.
    //
    // `replaceOverlayConfigs` is a wholesale swap per section, which is what
    // makes it safe to re-run and what makes it destructive: a library that
    // already had badges loses them. That's why the option is opt-in at the
    // wizard rather than implied by importing a config with overlay files.
    for (const layout of overlays) {
      ctx.signal?.throwIfAborted();
      try {
        // Validated rather than cast: the plan is a config blob that has been
        // to disk and back, and a badge type this build doesn't have would be
        // written straight into `overlay_configs` and then fail to render with
        // no trace of where it came from.
        const configs = layout.configs.flatMap((c) => {
          const position = overlayPositionSchema.safeParse(c.position);
          const overlayType = overlayTypeSchema.safeParse(c.overlayType);
          if (!position.success || !overlayType.success) {
            ctx.log(`Skipped an unrecognised overlay (${c.overlayType} at ${c.position}).`);
            return [];
          }
          return [
            {
              position: position.data,
              overlayType: overlayType.data,
              style: badgeStyleSchema.nullish().parse(c.style) ?? null,
              rule: conditionalRuleSchema.nullish().parse(c.rule) ?? null,
              order: c.order,
            },
          ];
        });
        if (configs.length === 0) continue;

        replaceOverlayConfigs(layout.sectionId, configs);
        ctx.log(`Applied ${configs.length} overlay badge(s) to "${layout.sectionTitle}".`);
      } catch (err) {
        ctx.log(`Couldn't apply overlays to "${layout.sectionTitle}": ${(err as Error).message ?? err}`);
      }
    }
    if (overlays.length > 0) {
      ctx.log("Overlays are drawn by the `overlays` job — run it to see them on your posters.");
    }

    // 4. Store per-item metadata edits.
    //
    // Stored, not applied: writing four hundred summaries into somebody's
    // library is not something a migration should do on its way past. The
    // `metadata-overrides` job writes them, and only once the global metadata
    // switch is on — so the edits are safe here whatever that switch says.
    let storedOverrides = 0;
    for (const layout of metadataOverrides) {
      ctx.signal?.throwIfAborted();
      try {
        storedOverrides += upsertOverrides(
          layout.overrides.map((o) => ({
            sectionId: layout.sectionId,
            match: o.match,
            fields: o.fields,
            tags: o.tags,
            source: "kometa",
          })),
        );
      } catch (err) {
        ctx.log(`Couldn't store metadata edits for "${layout.sectionTitle}": ${(err as Error).message ?? err}`);
      }
    }
    if (storedOverrides > 0) {
      ctx.log(`Stored ${storedOverrides} per-item metadata edit(s). Run the metadata-overrides job to apply them.`);
    }

    // 5. Refresh scan state and mark migration complete so the banner stays
    // dismissed even after future syncs reveal additional collections.
    // The banner formula short-circuits on `completedAt != null`, so no
    // further dismissed_at touch is needed.
    await scanProviderState(providerId);
    markProviderCompleted(providerId);
    deleteConfig("migration_pending_plan");

    // Record what was created against what it replaced. This is the only place
    // the two are known together, and without it the verification screen has
    // nothing to diff — a migrated rule carries no trace of its origin.
    setConfig("migration_last_result", { providerId, completedAt: Date.now(), entries: outcome });

    ctx.log("Migration complete.");
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
  config: Parameters<ReturnType<typeof createMigrateCollectionsCommand>["run"]>[1],
): Promise<void> {
  return createMigrateCollectionsCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}
