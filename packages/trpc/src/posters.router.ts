import { kometaPosterSourceSchema, resolveKometaUrl } from "@tinkerbell/posters";
import { posterCache } from "@tinkerbell/core";
import { procedure, t } from "./_base.ts";

export const postersRouter = t.router({
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

  clearCache: procedure.mutation(async () => {
    await posterCache().clear();
    return { ok: true as const };
  }),
});
