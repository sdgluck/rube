/**
 * TMDb keywords by name, for the person choosing which ones make a season.
 *
 * Rube otherwise only ever sees keyword *ids* — `fetchItemDetails` keeps
 * the ids and drops the names, which is all matching needs. A season editor
 * that asked an admin to type `207317` would be asking them to go and look it
 * up on themoviedb.org, so the editor searches here and stores the name beside
 * the id it picked.
 */

import { z } from "zod";
import { tmdbFetch, type TmdbConfig } from "./_shared.ts";

const keywordSchema = z.object({ id: z.number(), name: z.string() });

const searchKeywordResponseSchema = z.object({
  page: z.number(),
  total_pages: z.number(),
  results: z.array(keywordSchema).default([]),
});

export interface TmdbKeyword {
  id: number;
  name: string;
}

/** Keywords whose name matches `query`, in TMDb's order. */
export async function searchKeywords(
  cfg: TmdbConfig,
  query: string,
  opts: { page?: number } = {},
): Promise<TmdbKeyword[]> {
  const trimmed = query.trim();
  // An empty `query` is a 422 from TMDb; there is nothing to look up.
  if (!trimmed) return [];
  const data = await tmdbFetch(cfg, "/search/keyword", searchKeywordResponseSchema, {
    query: trimmed,
    page: String(opts.page ?? 1),
  });
  return data.results.map((k) => ({ id: k.id, name: k.name }));
}

/** One keyword by id — how a shipped season's ids are checked against what TMDb calls them. */
export async function fetchKeyword(cfg: TmdbConfig, id: number): Promise<TmdbKeyword> {
  const data = await tmdbFetch(cfg, `/keyword/${id}`, keywordSchema);
  return { id: data.id, name: data.name };
}
