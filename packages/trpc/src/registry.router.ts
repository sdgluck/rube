import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { registryImportOverridesSchema } from "@tinkerbell/contracts";
import { registryUrl, type TagLookup } from "@tinkerbell/domain.registry";

import { procedure, t, mapNotConfiguredClient } from "./_base.ts";

const importInput = z.object({
  packSlug: z.string().nullable().default(null),
  ruleSlugs: z.array(z.string()).min(1),
  sectionTitles: z.array(z.string()).min(1),
  /** Import-time tweaks to the pack's published config — see contracts. */
  overrides: registryImportOverridesSchema.default({}),
});

export function createRegistryRouter(deps: TrpcDeps) {
  /**
   * Tag lookups are the one place import touches Plex. Built per request so a
   * server that becomes reachable between calls isn't stuck with a dead client,
   * and so the resolver stays free of any Plex import of its own.
   */
  function plexTagLookup(): TagLookup {
    return (sectionId, field) => getPlexClient().getFilterFieldValues(sectionId, field);
  }

  const { clients } = deps;
  const getPlexClient = mapNotConfiguredClient(clients);
  const { registry, sections } = deps;
  const { applyUpdate, buildImportPlan, checkForUpdates, getRegistry, importPlan } = registry;
  const { getLocalSections } = sections;

  /** Section titles are what rules are scoped by; keys are what tag lookups
   *  need. Callers hand us titles, so map back to keys here. */
  function resolveTargets(sectionTitles: string[]): { sectionId: string; sectionTitle: string }[] {
    const sections = getLocalSections();
    const byTitle = new Map(sections.map((s) => [s.title.toLowerCase(), s]));
    return sectionTitles.flatMap((title) => {
      const section = byTitle.get(title.toLowerCase());
      return section ? [{ sectionId: section.key, sectionTitle: section.title }] : [];
    });
  }

  const registryRouter = t.router({
    /** The catalogue, cached for an hour. `force` refetches. */
    index: procedure
      .input(z.object({ force: z.boolean().default(false) }).default({ force: false }))
      .query(async ({ input }) => {
        const { index } = await getRegistry({ force: input.force });
        return { ...index, sourceUrl: registryUrl() };
      }),

    /**
     * Dry run. Everything that could go wrong after import — an unresolvable
     * clause, a missing integration, a name collision — is reported here so the
     * modal can show it before the user commits.
     */
    previewImport: procedure.input(importInput).query(async ({ input }) => {
      const targets = resolveTargets(input.sectionTitles);
      if (targets.length === 0) {
        throw new Error("None of the selected libraries exist on this Plex server. Refresh libraries and try again.");
      }
      return buildImportPlan(
        { packSlug: input.packSlug, ruleSlugs: input.ruleSlugs, targets, overrides: input.overrides },
        plexTagLookup(),
      );
    }),

    import: procedure.input(importInput.extend({ enabled: z.boolean().default(false) })).mutation(async ({ input }) => {
      const targets = resolveTargets(input.sectionTitles);
      if (targets.length === 0) {
        throw new Error("None of the selected libraries exist on this Plex server. Refresh libraries and try again.");
      }
      // Re-planned rather than trusting a plan round-tripped through the
      // client: the preview is a UI affordance, not an authorisation token.
      const plan = await buildImportPlan(
        { packSlug: input.packSlug, ruleSlugs: input.ruleSlugs, targets, overrides: input.overrides },
        plexTagLookup(),
      );
      const created = importPlan(plan, { enabled: input.enabled });
      return { created: created.map((r) => ({ id: r.id, name: r.name, type: r.type })) };
    }),

    updates: procedure.query(() => checkForUpdates()),

    applyUpdate: procedure.input(z.object({ ruleId: z.string() })).mutation(async ({ input }) => {
      const sectionsByTitle = new Map(getLocalSections().map((s) => [s.title.toLowerCase(), s.key]));
      const rule = await applyUpdate(input.ruleId, sectionsByTitle, plexTagLookup());
      return { id: rule.id, name: rule.name };
    }),
  });

  return registryRouter;
}
