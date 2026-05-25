import { z } from "zod";
import {
  getUserPreferences,
  setUserPreferences,
  listOptedInUserPreferences,
  userPreferencesSchema,
  getConfig,
} from "@tinkerbell/core";
import { t, procedure, getPlexClient } from "./_base.ts";

/**
 * Per-user personalization preferences. Today these endpoints take an explicit
 * `userId` (admin trust model — the whole tRPC API is admin-only). When the
 * Sign-in-with-Plex portal lands it will call session-scoped variants that
 * derive `userId` from the authenticated user instead.
 */
export const preferencesRouter = t.router({
  get: procedure.input(z.object({ userId: z.number().int() })).query(({ input }) => {
    return getUserPreferences(input.userId);
  }),

  set: procedure
    .input(
      z.object({
        userId: z.number().int(),
        preferences: userPreferencesSchema,
        optedIn: z.boolean(),
      }),
    )
    .mutation(({ input }) => {
      setUserPreferences(input.userId, input.preferences, input.optedIn);
      return { ok: true };
    }),

  list: procedure.query(() => listOptedInUserPreferences()),

  // Distinct genres across configured libraries, for the preference picker.
  availableGenres: procedure.query(async () => {
    const client = getPlexClient();
    let sections = await client.getSections();
    const configured = getConfig("global_plex_libraries");
    if (configured) sections = sections.filter((s) => configured.includes(s.title));

    const genres = new Set<string>();
    for (const section of sections) {
      try {
        const values = await client.getFilterFieldValues(section.key, "genre");
        for (const v of values) genres.add(v.title);
      } catch {
        // A section without genre facets is fine — skip it.
      }
    }
    return [...genres].sort((a, b) => a.localeCompare(b));
  }),
});
