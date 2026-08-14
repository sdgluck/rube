import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import { db, rules } from "@tinkerbell/db";
import { getConfig } from "@tinkerbell/core";
import { LOCAL_FIELD_DEFS } from "@tinkerbell/contracts";
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
import { paginationInput } from "./_pagination.ts";

export const collectionsRouter = t.router({
  list: t.procedure
    .input(
      paginationInput.extend({
        // Value filters are lists — the page's controls are multi-selects.
        sectionIds: z.array(z.string()).default([]),
        labels: z.array(z.string()).default([]),
        ruleIds: z.array(z.string()).default([]),
        search: z.string().optional(),
        sort: z.string().optional(),
        sortDir: z.enum(["asc", "desc"]).default("asc"),
      }),
    )
    .query(({ input }) => {
      // A rule also claims the collection recorded as its last generated one,
      // even when that collection carries no `Rule:<id>` label — see
      // `getLocalCollections`.
      const ruleLastRatingKeys: Record<string, string> = {};
      if (input.ruleIds.length > 0) {
        const rows = db
          .select({ id: rules.id, key: rules.lastCollectionRatingKey })
          .from(rules)
          .where(inArray(rules.id, input.ruleIds))
          .all();
        for (const row of rows) {
          if (row.key) ruleLastRatingKeys[row.id] = row.key;
        }
      }
      return getLocalCollections({
        sectionIds: input.sectionIds,
        labels: input.labels,
        ruleIds: input.ruleIds,
        ruleLastRatingKeys,
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

  /**
   * Key → title for several tag fields at once, as one `{ field: { key: title } }`
   * map. Callers that render many filters at once (the rules list) resolve
   * every clause from a single query instead of one per clause.
   *
   * With no `sectionId` the maps are merged across every section, because a
   * list of rules spans libraries and Plex tag keys are unique server-wide.
   * Only ask for small facets this way — `actor` on a large library is tens of
   * thousands of rows.
   */
  filterFieldValuesBatch: procedure
    .input(z.object({ sectionId: z.string().optional(), fields: z.array(z.string()).max(12) }))
    .query(async ({ input }) => {
      const client = getPlexClient();
      const sectionIds = input.sectionId ? [input.sectionId] : (await client.getSections()).map((s) => s.key);
      const out: Record<string, Record<string, string>> = {};

      await Promise.all(
        [...new Set(input.fields)].flatMap((field) =>
          sectionIds.map(async (sectionId) => {
            try {
              const values = await client.getFilterFieldValues(sectionId, field);
              const bucket = (out[field] ??= {});
              for (const v of values) bucket[v.key] = v.title;
            } catch {
              // A facet Plex doesn't expose for this section type 404s. Falling
              // back to the raw value beats failing the whole query.
              out[field] ??= {};
            }
          }),
        ),
      );
      return out;
    }),

  updateSmartFilters: t.procedure
    .input(z.object({ ratingKey: z.string(), contentUri: z.string() }))
    .mutation(async ({ input }) => {
      // A Plex smart collection is evaluated by Plex, on demand, forever — so
      // it can only reference fields Plex knows. A `tb.` field would be sent
      // as a query parameter Plex ignores, and the collection would silently
      // widen to everything the remaining clauses match. Watch-history fields
      // are only valid on Tinkerbell rules, which build static collections.
      const localField = LOCAL_FIELD_DEFS.map((d) => d.field).find(
        (f) => input.contentUri.includes(`${encodeURIComponent(f)}=`) || input.contentUri.includes(`${f}=`),
      );
      if (localField) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `"${localField}" is a Tinkerbell watch-history field. Plex evaluates smart collections itself and has no such field, so it can only be used on a Tinkerbell rule that builds a static collection.`,
        });
      }

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
