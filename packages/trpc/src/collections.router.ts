import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, rules } from "@tinkerbell/db";
import { getConfig } from "@tinkerbell/core";
import {
  syncCollections,
  getLocalCollections,
  getLocalCollection,
  getCollectionFilters,
  updateCollection,
  updateCollectionLabels,
  deleteCollection,
} from "@tinkerbell/domain.collections";
import { t, procedure, getPlexClient } from "./_base.ts";

export const collectionsRouter = t.router({
  list: t.procedure
    .input(
      z.object({
        sectionId: z.string().optional(),
        label: z.string().optional(),
        search: z.string().optional(),
        offset: z.number().default(0),
        limit: z.number().default(50),
        sort: z.string().optional(),
        sortDir: z.enum(["asc", "desc"]).default("asc"),
      }),
    )
    .query(({ input }) => {
      return getLocalCollections({
        sectionId: input.sectionId,
        label: input.label,
        search: input.search || undefined,
        offset: input.offset,
        limit: input.limit,
        sort: input.sort,
        sortDir: input.sortDir,
      });
    }),

  filters: procedure.query(() => {
    return getCollectionFilters();
  }),

  get: procedure.input(z.object({ ratingKey: z.string() })).query(({ input }) => {
    const row = getLocalCollection(input.ratingKey);
    if (!row) throw new Error(`Collection ${input.ratingKey} not found`);
    return row;
  }),

  items: procedure.input(z.object({ ratingKey: z.string() })).query(async ({ input }) => {
    const client = getPlexClient();
    return client.getCollectionChildren(input.ratingKey);
  }),

  update: t.procedure
    .input(z.object({ ratingKey: z.string(), title: z.string().optional(), summary: z.string().optional() }))
    .mutation(async ({ input }) => {
      const { ratingKey, ...updates } = input;
      const client = getPlexClient();
      await updateCollection(client, ratingKey, updates);
      return { ok: true };
    }),

  updateLabels: t.procedure
    .input(z.object({ ratingKey: z.string(), labels: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      const client = getPlexClient();
      await updateCollectionLabels(client, input.ratingKey, input.labels);
      return { ok: true };
    }),

  delete: procedure.input(z.object({ ratingKey: z.string() })).mutation(async ({ input }) => {
    const client = getPlexClient();
    await deleteCollection(client, input.ratingKey);
    return { ok: true };
  }),

  smartConfig: procedure.input(z.object({ ratingKey: z.string() })).query(async ({ input }) => {
    const client = getPlexClient();
    return client.getSmartCollectionContent(input.ratingKey);
  }),

  owningRule: procedure.input(z.object({ ratingKey: z.string() })).query(({ input }) => {
    const row = db
      .select({ id: rules.id, name: rules.name, type: rules.type })
      .from(rules)
      .where(eq(rules.lastCollectionRatingKey, input.ratingKey))
      .get();
    return row ?? null;
  }),

  filterFieldValues: procedure
    .input(z.object({ sectionId: z.string(), field: z.string() }))
    .query(async ({ input }) => {
      const client = getPlexClient();
      return client.getFilterFieldValues(input.sectionId, input.field);
    }),

  updateSmartFilters: t.procedure
    .input(z.object({ ratingKey: z.string(), contentUri: z.string() }))
    .mutation(async ({ input }) => {
      const client = getPlexClient();
      await client.updateSmartCollectionContent(input.ratingKey, input.contentUri);
      return { ok: true };
    }),

  sync: procedure.mutation(async () => {
    const client = getPlexClient();
    let sections = await client.getSections();
    const configuredLibraries = getConfig("global_plex_libraries");
    if (configuredLibraries) {
      sections = sections.filter((s) => configuredLibraries.includes(s.title));
    }
    return syncCollections(client, sections);
  }),
});
