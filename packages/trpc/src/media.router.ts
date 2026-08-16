import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, rules } from "@tinkerbell/db";
import { getConfig, setConfig } from "@tinkerbell/core";
import { narrateSmartFilter, ruleConfigSchema } from "@tinkerbell/contracts";
import { getLocalMediaItems } from "@tinkerbell/domain.media";
import { getCollectionsForItem } from "@tinkerbell/domain.collections";
import { t, procedure, getPlexClient } from "./_base.ts";
import { paginationInput } from "./_pagination.ts";

export const mediaRouter = t.router({
  list: procedure
    .input(
      paginationInput.extend({
        // Value filters are lists: the page's controls are multi-selects, so
        // each one carries every ticked value. Empty means "filter off".
        sectionIds: z.array(z.string()).default([]),
        types: z.array(z.string()).default([]),
        search: z.string().optional(),
        videoResolutions: z.array(z.string()).default([]),
        videoCodecs: z.array(z.string()).default([]),
        audioCodecs: z.array(z.string()).default([]),
        audioChannels: z.array(z.number()).default([]),
        containers: z.array(z.string()).default([]),
        sort: z.string().optional(),
        sortDir: z.enum(["asc", "desc"]).default("asc"),
      }),
    )
    .query(({ input }) => {
      return getLocalMediaItems({
        sectionIds: input.sectionIds,
        types: input.types,
        search: input.search || undefined,
        offset: input.offset,
        limit: input.limit,
        videoResolutions: input.videoResolutions,
        videoCodecs: input.videoCodecs,
        audioCodecs: input.audioCodecs,
        audioChannels: input.audioChannels,
        containers: input.containers,
        sort: input.sort,
        sortDir: input.sortDir,
      });
    }),

  get: procedure.input(z.object({ ratingKey: z.string() })).query(async ({ input }) => {
    const client = getPlexClient();
    const detail = await client.getItemDetail(input.ratingKey);

    // Use the local membership index instead of the Plex item's `Collection`
    // refs: the latter only covers static collections, while the index also
    // captures smart-collection membership (populated during sync).
    const enrichedCollections = getCollectionsForItem(input.ratingKey).map((row) => ({
      ratingKey: row.plexRatingKey,
      title: row.title,
      sectionTitle: row.sectionTitle,
    }));

    return {
      ...detail,
      collections: enrichedCollections,
    };
  }),

  /**
   * Why this item is where it is.
   *
   * The detail page could already list the collections an item belongs to, and
   * stopped there — which answers "where" and leaves "why" to whoever fancies
   * opening every rule and reading its filter. For each collection this names
   * the rule behind it and states that rule's criteria in the same English the
   * filter editor uses.
   *
   * A collection with no rule behind it is reported as such rather than
   * omitted: "somebody made this by hand in Plex" is a real and useful answer.
   */
  why: procedure.input(z.object({ ratingKey: z.string() })).query(({ input }) => {
    return getCollectionsForItem(input.ratingKey).map((row) => {
      const ruleId = row.labels.find((l) => l.startsWith("Rule:"))?.slice("Rule:".length);
      const rule = ruleId
        ? db
            .select({ id: rules.id, name: rules.name, type: rules.type, config: rules.config })
            .from(rules)
            .where(eq(rules.id, ruleId))
            .get()
        : undefined;

      let criteria: string | null = null;
      if (rule) {
        const parsed = ruleConfigSchema.safeParse(rule.config);
        const filter = parsed.success ? parsed.data.smartFilter : undefined;
        if (filter && filter.children.length > 0) {
          // Rules store tag values as display names already, so no per-server
          // lookup is needed to render them readably.
          criteria = narrateSmartFilter(filter, { noun: "items" });
        }
      }

      return {
        collection: { ratingKey: row.plexRatingKey, title: row.title, sectionTitle: row.sectionTitle },
        rule: rule ? { id: rule.id, name: rule.name, type: rule.type } : null,
        criteria,
      };
    });
  }),

  children: procedure.input(z.object({ ratingKey: z.string() })).query(async ({ input }) => {
    const client = getPlexClient();
    return client.getMetadataChildren(input.ratingKey);
  }),

  columns: procedure.query(() => {
    return getConfig("media_columns") ?? null;
  }),

  saveColumns: procedure.input(z.array(z.object({ id: z.string(), visible: z.boolean() }))).mutation(({ input }) => {
    setConfig("media_columns", input);
    return { ok: true };
  }),
});
