import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  derivePalette,
  kometaPosterSourceSchema,
  renderCollectionPoster,
  resolveKometaUrl,
  fetchPosterUrl,
  indexAssetDirectory,
} from "@rube/posters";
import { errorMessage } from "@rube/core";
import {
  presentationConfigSchema,
  resolvePosterTemplate,
  resolveCollectionSummary,
  templatedCollectionSummary,
} from "@rube/contracts";

import { procedure, t, mapNotConfiguredClient } from "./_base.ts";

/** Member posters sampled for a preview — enough to fill the widest mosaic. */
const PREVIEW_MEMBERS = 6;

export function createPostersRouter(deps: Pick<TrpcDeps, "clients" | "media" | "postersCache">) {
  const posterCache = () => deps.postersCache;
  const { clients } = deps;
  const getPlexClient = mapNotConfiguredClient(clients);
  const { media } = deps;
  const { getLocalMediaItems } = media;

  const postersRouter = t.router({
    /**
     * What an asset directory holds, read the way the artwork job will read
     * it — so "Found 212 assets" or "No directory found" appears while the
     * path is being typed rather than as a log line after the first run.
     * The index is capped in depth and size, so a mistyped `/` stays cheap.
     */
    assetDirectory: procedure.input(z.object({ path: z.string() })).query(async ({ input }) => {
      try {
        const index = await indexAssetDirectory(input.path.trim());
        return { found: index.size, error: null };
      } catch (err) {
        return { found: 0, error: errorMessage(err) };
      }
    }),

    /**
     * Resolve a Kometa source to a URL and return whether the asset
     * actually exists upstream. Used by the Settings UI to preview the
     * style picker without round-tripping every test through Plex.
     */
    preview: procedure.input(kometaPosterSourceSchema).query(async ({ input }) => {
      const url = resolveKometaUrl(input);
      const result = await posterCache().getOrFetch(url);
      return {
        url,
        status: result.status,
        fromCache: result.fromCache,
      };
    }),

    /**
     * Render the poster a rule would produce, as a data URL.
     *
     * Nobody will switch artwork generation on blind — it writes to their Plex
     * server — so the wizard has to show the actual image, rendered by the
     * actual renderer. A preview drawn a second way in the browser would be a
     * preview of something else.
     *
     * Member art is sampled from the local media mirror rather than by running
     * the rule: the rule test already exists and costs a full Plex walk, and
     * what the user is choosing here is the *template*, which four real posters
     * from the right library demonstrate exactly as well as the right four.
     */
    previewCollectionPoster: procedure
      .input(
        z.object({
          presentation: presentationConfigSchema,
          title: z.string().min(1).max(200),
          ruleType: z.string().optional(),
          /** Library to sample member art from. Absent means any library. */
          sectionId: z.string().optional(),
          sectionType: z.string().optional(),
          /** Specific members, when the caller already has a preview result. */
          ratingKeys: z.array(z.string()).max(PREVIEW_MEMBERS).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const summary = input.ruleType
          ? resolveCollectionSummary(input.presentation, {
              ruleType: input.ruleType,
              collectionName: input.title,
              sectionType: input.sectionType,
            })
          : null;

        if (input.presentation.poster === "none") {
          return { dataUrl: null, template: null, summary: summary?.text ?? null, memberPosters: 0 };
        }

        if (input.presentation.poster === "url") {
          const url = input.presentation.posterUrl?.trim() ?? "";
          const fetched = await fetchPosterUrl(url);
          if (fetched.status === "rejected") {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Poster URL rejected — ${fetched.reason}` });
          }
          return {
            dataUrl: `data:${fetched.contentType};base64,${fetched.buffer.toString("base64")}`,
            template: "url" as const,
            summary: summary?.text ?? null,
            memberPosters: 0,
          };
        }

        const thumbs = sampleThumbs(input.ratingKeys, input.sectionId);
        const client = getPlexClient();
        const memberPosters: Buffer[] = [];
        for (const thumb of thumbs) {
          try {
            memberPosters.push(await client.downloadPoster(thumb));
          } catch {
            // A thumb Plex won't serve is one fewer cell to fill; every template
            // renders from however many turn up, including none.
          }
        }

        const template = resolvePosterTemplate(input.presentation.poster, memberPosters.length);
        try {
          const palette = await derivePalette(memberPosters, input.presentation.accentColor);
          const buffer = await renderCollectionPoster(template, {
            title: input.title,
            subtitle: undefined,
            memberPosters,
            palette,
          });
          return {
            dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`,
            template,
            summary: summary?.text ?? null,
            memberPosters: memberPosters.length,
          };
        } catch (err) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: errorMessage(err) });
        }
      }),

    /** The templated sentence for a rule type, for the wizard's summary field. */
    previewCollectionSummary: procedure
      .input(
        z.object({
          ruleType: z.string(),
          collectionName: z.string().min(1).max(200),
          sectionType: z.string().optional(),
        }),
      )
      .query(({ input }) => ({
        summary: templatedCollectionSummary({
          ruleType: input.ruleType,
          collectionName: input.collectionName,
          sectionType: input.sectionType,
        }),
      })),

    clearCache: procedure.mutation(async () => {
      await posterCache().clear();
      return { ok: true as const };
    }),
  });

  /** Thumb paths for the preview's member art, from the local media mirror. */
  function sampleThumbs(ratingKeys: string[] | undefined, sectionId: string | undefined): string[] {
    const { items } = getLocalMediaItems({
      sectionIds: sectionId ? [sectionId] : undefined,
      limit: ratingKeys?.length ? 500 : PREVIEW_MEMBERS,
    });
    const wanted = ratingKeys?.length ? new Set(ratingKeys) : null;
    return items
      .filter((item) => (wanted ? wanted.has(item.ratingKey) : true))
      .map((item) => item.thumb)
      .filter((thumb): thumb is string => !!thumb)
      .slice(0, PREVIEW_MEMBERS);
  }

  return postersRouter;
}
