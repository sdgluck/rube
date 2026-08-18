import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import { rules } from "@tinkerbell/db";
import { errorMessage } from "@tinkerbell/core";
import { LOCAL_FIELD_DEFS, posterUrlError, resolvePosterTemplate } from "@tinkerbell/contracts";
import { derivePalette, fetchPosterUrl, renderCollectionPoster } from "@tinkerbell/posters";

import { t, procedure, mapNotConfiguredClient } from "./_base.ts";
import { createPreviewCache } from "./preview.router.ts";
import { paginationInput } from "./_pagination.ts";

const ratingKeyInput = z.object({ ratingKey: z.string() });

/**
 * Shared by preview and apply so the two can't drift apart — a preview of a
 * different image than the one that lands is worse than no preview.
 */
const generatedPosterInput = ratingKeyInput.extend({
  // The generated sources only. `none` isn't renderable, and `url` has its own
  // procedure because it fetches rather than renders.
  poster: z.enum(["gradient", "mosaic", "spotlight"]),
  accentColor: z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
    .optional(),
});

/** Member posters sampled when rendering a poster for one real collection. */
const POSTER_MEMBERS = 6;

/**
 * A smart collection's membership *is* its filter. Plex evaluates it on demand,
 * so adding an item would either be discarded on the next evaluation or — via
 * the items endpoint, which is the same one the filter is written through —
 * replace the filter with a fixed list and quietly turn the collection dumb.
 */
function refuseIfSmart(row: { smart: number }, verb: string): void {
  if (row.smart === 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `This is a smart collection — Plex decides its members from a filter, so items can't be ${verb} by hand. Edit the filter instead.`,
    });
  }
}

export function createCollectionsRouter(deps: Pick<TrpcDeps, "clients" | "collections" | "config" | "db">) {
  const { clearPreviewCache } = createPreviewCache(deps);
  /**
   * Render a generated poster from a collection's own members.
   *
   * Member art comes from Plex through the collection itself, not from the local
   * media mirror: the mirror is a paged snapshot of a whole library, so sampling
   * it for a 15-member collection mostly returns things that aren't in it.
   */
  const { clients } = deps;
  const getPlexClient = mapNotConfiguredClient(clients);
  const { collections, config, db } = deps;
  const { getConfig } = config;

  /**
   * Render a generated poster from a collection's own members.
   *
   * Member art comes from Plex through the collection itself, not from the local
   * media mirror: the mirror is a paged snapshot of a whole library, so sampling
   * it for a 15-member collection mostly returns things that aren't in it.
   */
  async function renderForCollection(
    row: { plexRatingKey: string; title: string; smart: number },
    poster: "gradient" | "mosaic" | "spotlight",
    accentColor: string | undefined,
  ): Promise<{ buffer: Buffer; template: string }> {
    const client = getPlexClient();
    const members = await client.getCollectionChildren(row.plexRatingKey, { smart: row.smart === 1 });

    const memberPosters: Buffer[] = [];
    for (const member of members.slice(0, POSTER_MEMBERS)) {
      if (!member.thumb) continue;
      try {
        memberPosters.push(await client.downloadPoster(member.thumb));
      } catch {
        // One thumb Plex won't serve is one fewer cell; every template renders
        // from however many turn up, including none.
      }
    }

    const template = resolvePosterTemplate(poster, memberPosters.length);
    try {
      const palette = await derivePalette(memberPosters, accentColor);
      const buffer = await renderCollectionPoster(template, {
        title: row.title,
        subtitle: undefined,
        memberPosters,
        palette,
      });
      return { buffer, template };
    } catch (err) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: errorMessage(err) });
    }
  }

  const { setConfig } = config;
  const {
    syncCollections,
    getLocalCollections,
    getLocalCollection,
    getCollectionArtwork,
    getCollectionFilters,
    getCollectionStats,
    recordCollectionArtwork,
    updateCollection,
    updateCollectionLabels,
    upsertCollectionByKey,
    deleteCollection,
  } = collections;

  /**
   * The rule that owns a collection, by the `Rule:<id>` label it carries, and
   * failing that by the rule that recorded it as its last generated collection.
   *
   * The label is the durable link and the rating key is the fallback: smart
   * filter rules created by migration adopt a collection Tinkerbell never
   * labelled, so they can only be recognised the second way.
   */
  function owningRuleFor(ratingKey: string): { id: string; name: string; type: string } | null {
    const row = getLocalCollection(ratingKey);
    const labelled = row?.labels.find((l) => l.startsWith("Rule:"));
    if (labelled) {
      const rule = db
        .select({ id: rules.id, name: rules.name, type: rules.type })
        .from(rules)
        .where(eq(rules.id, labelled.slice("Rule:".length)))
        .get();
      if (rule) return rule;
    }
    return (
      db
        .select({ id: rules.id, name: rules.name, type: rules.type })
        .from(rules)
        .where(eq(rules.lastCollectionRatingKey, ratingKey))
        .get() ?? null
    );
  }

  /** The local row, or a 404 rather than a crash on a key we don't mirror. */
  function requireCollection(ratingKey: string) {
    const row = getLocalCollection(ratingKey);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Collection ${ratingKey} not found` });
    return row;
  }

  /** Re-read one collection from Plex into the local mirror. */
  async function resyncCollection(ratingKey: string, sectionId: string): Promise<void> {
    const client = getPlexClient();
    const section = (await client.getSections()).find((s) => s.key === sectionId);
    if (!section) return;
    await upsertCollectionByKey(client, section, ratingKey);
  }

  /**
   * Record that a person, not a job, chose this collection's poster.
   *
   * Only meaningful for a collection some rule owns — the ledger is keyed by
   * rule, and nothing rewrites the artwork of a collection no rule produced, so
   * there is nothing to lock. `priorThumb` is preserved by
   * `recordCollectionArtwork`'s partial write.
   */
  function lockPoster(ratingKey: string, title: string): void {
    const rule = owningRuleFor(ratingKey);
    if (!rule) return;
    const now = Date.now();
    recordCollectionArtwork(rule.id, title, { posterLockedAt: now, posterUploadedAt: now, inputHash: "" });
  }

  /**
   * Upload image bytes as the collection's poster, then lock and re-mirror.
   *
   * The one path every "set the poster" procedure goes through, so that locking
   * can't be forgotten by whichever source is added next — an unlocked custom
   * poster is one that `collection-art` silently replaces at 05:00.
   */
  async function applyPoster(
    ratingKey: string,
    buffer: Buffer,
    row: { title: string; sectionId: string },
  ): Promise<void> {
    const client = getPlexClient();
    await client.uploadPoster(ratingKey, buffer);
    lockPoster(ratingKey, row.title);
    await resyncCollection(ratingKey, row.sectionId);
  }

  const collectionsRouter = t.router({
    list: procedure
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

    columns: procedure.query(() => getConfig("collections_columns") ?? null),

    saveColumns: procedure.input(z.array(z.object({ id: z.string(), visible: z.boolean() }))).mutation(({ input }) => {
      setConfig("collections_columns", input);
      return { ok: true as const };
    }),

    /**
     * Every collection currently pinned to the Plex home screen, as a set of
     * rating keys.
     *
     * One request per library rather than one per row: the list shows fifty
     * collections and `getManagedHubs` answers for a whole section at once, so
     * the "Pinned" column costs a handful of calls however long the page is.
     */
    pinnedKeys: procedure.query(async () => {
      const client = getPlexClient();
      const sectionIds = [...new Set(getLocalCollections().items.map((c) => c.sectionId))];
      const pinned: string[] = [];
      await Promise.all(
        sectionIds.map(async (sectionId) => {
          try {
            for (const hub of await client.getManagedHubs(sectionId)) {
              if ((hub.promotedToOwnHome ?? 0) <= 0) continue;
              // `custom.collection.{sectionId}.{ratingKey}` — the last segment is
              // the collection this hub is for.
              const key = hub.identifier.split(".").pop();
              if (key) pinned.push(key);
            }
          } catch {
            // A section Plex won't answer for contributes no pins rather than
            // failing the column for every other library.
          }
        }),
      );
      return pinned;
    }),

    /**
     * What Tinkerbell has written onto each collection, keyed by rating key.
     *
     * Resolved here rather than per row because the ledger is keyed by
     * `(ruleId, collectionName)` and the list only knows rating keys — the join
     * needs the `Rule:<id>` label off every row, which is one local query for the
     * whole page instead of one round trip each.
     */
    artworkFlags: procedure.query(() => {
      const flags: Record<string, { managed: boolean; posterLocked: boolean }> = {};
      for (const row of getLocalCollections().items) {
        const labelled = row.labels.find((l) => l.startsWith("Rule:"));
        if (!labelled) continue;
        const artwork = getCollectionArtwork(labelled.slice("Rule:".length), row.title);
        if (!artwork) continue;
        flags[row.plexRatingKey] = {
          managed: !!artwork.posterUploadedAt || !!artwork.summarySource,
          posterLocked: !!artwork.posterLockedAt,
        };
      }
      return flags;
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

    update: procedure
      .input(z.object({ ratingKey: z.string(), title: z.string().optional(), summary: z.string().optional() }))
      .mutation(async ({ input }) => {
        const { ratingKey, ...updates } = input;
        const client = getPlexClient();
        await updateCollection(client, ratingKey, updates);
        return { ok: true };
      }),

    updateLabels: procedure
      .input(z.object({ ratingKey: z.string(), labels: z.array(z.string()) }))
      .mutation(async ({ input }) => {
        const client = getPlexClient();
        await updateCollectionLabels(client, input.ratingKey, input.labels);
        return { ok: true };
      }),

    delete: procedure.input(z.object({ ratingKey: z.string() })).mutation(async ({ input }) => {
      const client = getPlexClient();
      const { existedInPlex } = await deleteCollection(client, input.ratingKey);
      return { ok: true, existedInPlex };
    }),

    smartConfig: procedure.input(z.object({ ratingKey: z.string() })).query(async ({ input }) => {
      const client = getPlexClient();
      return client.getSmartCollectionContent(input.ratingKey);
    }),

    owningRule: procedure.input(ratingKeyInput).query(({ input }) => owningRuleFor(input.ratingKey)),

    stats: procedure.input(ratingKeyInput).query(({ input }) => getCollectionStats(input.ratingKey)),

    /**
     * The other collections the same rule produced. Sibling shelves are how a
     * generated set is actually navigated — "Directed by Nolan" is only
     * interesting next to the other thirty directors the rule made.
     */
    related: procedure.input(ratingKeyInput).query(({ input }) => {
      const rule = owningRuleFor(input.ratingKey);
      if (!rule) return { rule: null, collections: [] };
      const { items } = getLocalCollections({
        ruleIds: [rule.id],
        ruleLastRatingKeys: {},
        limit: 24,
      });
      return { rule, collections: items.filter((c) => c.plexRatingKey !== input.ratingKey) };
    }),

    // ─── Membership ───────────────────────────────────────────────────────────

    addItems: procedure
      .input(ratingKeyInput.extend({ itemRatingKeys: z.array(z.string()).min(1).max(500) }))
      .mutation(async ({ input }) => {
        const row = requireCollection(input.ratingKey);
        refuseIfSmart(row, "added");
        const client = getPlexClient();
        const { machineIdentifier } = await client.getIdentity();
        await client.addCollectionItems(input.ratingKey, machineIdentifier, input.itemRatingKeys);
        await resyncCollection(input.ratingKey, row.sectionId);
        return { ok: true as const, added: input.itemRatingKeys.length };
      }),

    removeItems: procedure
      .input(ratingKeyInput.extend({ itemRatingKeys: z.array(z.string()).min(1).max(500) }))
      .mutation(async ({ input }) => {
        const row = requireCollection(input.ratingKey);
        refuseIfSmart(row, "removed");
        const client = getPlexClient();
        let removed = 0;
        for (const itemRatingKey of input.itemRatingKeys) {
          if (await client.removeCollectionItem(input.ratingKey, itemRatingKey)) removed++;
        }
        await resyncCollection(input.ratingKey, row.sectionId);
        // `removed` can trail what was asked for when something was already gone.
        // The caller reports the number that was true, not the number requested.
        return { ok: true as const, removed };
      }),

    // ─── Plex-side presentation ───────────────────────────────────────────────

    /**
     * Read from Plex rather than the local mirror, which has no columns for
     * these. They're changed rarely and from several places (the Plex app, this
     * page, Kometa), so a stale mirrored copy would be a control showing the
     * wrong current value — worse than one extra request on a tab nobody opens
     * every visit.
     */
    prefs: procedure.input(ratingKeyInput).query(async ({ input }) => {
      const client = getPlexClient();
      const detail = await client.getCollectionDetail(input.ratingKey);
      return { collectionMode: detail.collectionMode, collectionSort: detail.collectionSort };
    }),

    setPrefs: procedure
      .input(
        ratingKeyInput.extend({
          // Literals rather than a bare number: these are Plex's own pref enums,
          // and a value it doesn't have is a silent no-op on the server.
          collectionMode: z.union([z.literal(-1), z.literal(0), z.literal(1), z.literal(2)]).optional(),
          collectionSort: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        requireCollection(input.ratingKey);
        const client = getPlexClient();
        await client.setCollectionPrefs(input.ratingKey, {
          collectionMode: input.collectionMode,
          collectionSort: input.collectionSort,
        });
        return { ok: true as const };
      }),

    // ─── Homepage pinning ─────────────────────────────────────────────────────

    /**
     * Whether this collection is pinned to the Plex home screen, read from the
     * server rather than remembered locally — Plex is the only thing that knows,
     * and a rule run, another admin, or the Plex app itself can all change it.
     *
     * `rotatedByRule` warns that the answer is temporary: a rule with pinning on
     * re-chooses which of its collections are pinned on every run, so a pin set
     * by hand here survives only until tonight.
     */
    pinState: procedure.input(ratingKeyInput).query(async ({ input }) => {
      const row = requireCollection(input.ratingKey);
      const client = getPlexClient();
      const identifier = `custom.collection.${row.sectionId}.${input.ratingKey}`;
      const hubs = await client.getManagedHubs(row.sectionId);
      const hub = hubs.find((h) => h.identifier === identifier);
      const rule = owningRuleFor(input.ratingKey);
      const ruleConfig = rule
        ? db.select({ config: rules.config }).from(rules).where(eq(rules.id, rule.id)).get()?.config
        : undefined;
      const config = (ruleConfig ?? {}) as { pinToHomepage?: boolean };

      return {
        pinned: !!hub && (hub.promotedToOwnHome ?? 0) > 0,
        hubIdentifier: identifier,
        rotatedByRule: rule && config.pinToHomepage !== false ? rule.name : null,
      };
    }),

    pin: procedure.input(ratingKeyInput).mutation(async ({ input }) => {
      const row = requireCollection(input.ratingKey);
      const client = getPlexClient();
      await client.pinToHomepage(row.sectionId, input.ratingKey, {
        promotedToOwnHome: 1,
        promotedToRecommendedHome: 1,
        promotedToSharedHome: 1,
      });
      clearPreviewCache();
      return { ok: true as const };
    }),

    unpin: procedure.input(ratingKeyInput).mutation(async ({ input }) => {
      const row = requireCollection(input.ratingKey);
      const client = getPlexClient();
      await client.unpinFromHomepage(row.sectionId, `custom.collection.${row.sectionId}.${input.ratingKey}`);
      clearPreviewCache();
      return { ok: true as const };
    }),

    // ─── Artwork ──────────────────────────────────────────────────────────────

    /** Plex's own poster options for this collection, for the studio's picker. */
    posterCandidates: procedure.input(ratingKeyInput).query(async ({ input }) => {
      const client = getPlexClient();
      return client.getPosters(input.ratingKey);
    }),

    /**
     * The poster `applyGeneratedPoster` would upload, as a data URL, without
     * uploading it.
     *
     * Distinct from `posters.previewCollectionPoster`, which previews what a
     * *rule* would produce and so samples member art from the local mirror —
     * for a collection that already exists, sampling shows art that isn't in
     * it. Both procedures below go through `renderForCollection`, so what is
     * previewed here is the image that gets uploaded, not one like it.
     */
    previewGeneratedPoster: procedure.input(generatedPosterInput).query(async ({ input }) => {
      const row = requireCollection(input.ratingKey);
      const { buffer, template } = await renderForCollection(row, input.poster, input.accentColor);
      return { dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`, template };
    }),

    /**
     * Render one of the generated templates for *this* collection — its real
     * title, its real member art — and upload it.
     */
    applyGeneratedPoster: procedure.input(generatedPosterInput).mutation(async ({ input }) => {
      const row = requireCollection(input.ratingKey);
      const { buffer, template } = await renderForCollection(row, input.poster, input.accentColor);
      await applyPoster(input.ratingKey, buffer, row);
      return { ok: true as const, template };
    }),

    /**
     * Set the poster from a URL. Tinkerbell fetches it and uploads the bytes
     * rather than handing the URL to Plex: the allowlist and the size cap are
     * only worth anything if the fetch happens somewhere they apply.
     */
    setPosterUrl: procedure.input(ratingKeyInput.extend({ url: z.string() })).mutation(async ({ input }) => {
      const row = requireCollection(input.ratingKey);
      const rejection = posterUrlError(input.url);
      if (rejection) throw new TRPCError({ code: "BAD_REQUEST", message: rejection });

      const fetched = await fetchPosterUrl(input.url);
      if (fetched.status === "rejected") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Poster URL rejected — ${fetched.reason}` });
      }
      await applyPoster(input.ratingKey, fetched.buffer, row);
      return { ok: true as const };
    }),

    /** Choose one of the posters Plex already holds for this collection. */
    selectPoster: procedure.input(ratingKeyInput.extend({ posterKey: z.string() })).mutation(async ({ input }) => {
      const row = requireCollection(input.ratingKey);
      const client = getPlexClient();
      await client.selectPoster(input.ratingKey, input.posterKey);
      lockPoster(input.ratingKey, row.title);
      await resyncCollection(input.ratingKey, row.sectionId);
      return { ok: true as const };
    }),

    /**
     * What Tinkerbell has written onto this collection, and what was there
     * first. Null for a collection no rule owns — nothing has ever written to it,
     * which is itself the answer.
     */
    artworkState: procedure.input(ratingKeyInput).query(({ input }) => {
      const row = requireCollection(input.ratingKey);
      const rule = owningRuleFor(input.ratingKey);
      if (!rule) return null;
      const artwork = getCollectionArtwork(rule.id, row.title);
      if (!artwork) return null;
      return { rule, ...artwork };
    }),

    /**
     * Stop Tinkerbell managing this collection's artwork.
     *
     * Honest about its limits: collections are deleted and recreated on every
     * rule run, so there is usually no image to put back — what this does is
     * lock the poster and clear the render bookkeeping so nothing overwrites it
     * again. `priorThumb` is returned so the caller can say whether an original
     * was ever recorded rather than implying one was restored.
     */
    revertArtwork: procedure.input(ratingKeyInput).mutation(({ input }) => {
      const row = requireCollection(input.ratingKey);
      const rule = owningRuleFor(input.ratingKey);
      if (!rule) return { ok: true as const, priorThumb: "" };
      const artwork = getCollectionArtwork(rule.id, row.title);
      recordCollectionArtwork(rule.id, row.title, {
        inputHash: "",
        posterUploadedAt: null,
        posterLockedAt: Date.now(),
        summaryLockedAt: Date.now(),
      });
      return { ok: true as const, priorThumb: artwork?.priorThumb ?? "" };
    }),

    /**
     * Called after an upload through `/api/collections/:ratingKey/poster`.
     *
     * The upload route can't do this itself: locking reads the rule ledger and
     * re-mirrors the collection, which is this router's work, and splitting it
     * out keeps the streaming route to the one thing it exists for. Locking
     * matters as much here as on the rendered path — an unlocked custom poster is
     * one `collection-art` replaces overnight.
     */
    posterUploaded: procedure.input(ratingKeyInput).mutation(async ({ input }) => {
      const row = requireCollection(input.ratingKey);
      lockPoster(input.ratingKey, row.title);
      await resyncCollection(input.ratingKey, row.sectionId);
      return { ok: true as const };
    }),

    /** Re-read this one collection from Plex, without a full library sync. */
    syncOne: procedure.input(ratingKeyInput).mutation(async ({ input }) => {
      const row = requireCollection(input.ratingKey);
      await resyncCollection(input.ratingKey, row.sectionId);
      return { ok: true as const };
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

    updateSmartFilters: procedure
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

  return collectionsRouter;
}
