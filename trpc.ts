import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { getAllConfig, getConfig, setConfig } from "./config.ts";

const t = initTRPC.create();

const configRouter = t.router({
  get: t.procedure.query(() => getAllConfig()),

  save: t.procedure.input(z.record(z.string(), z.string())).mutation(({ input }) => {
    for (const [key, value] of Object.entries(input)) {
      setConfig(key, value);
    }
    return { ok: true };
  }),
});

export const appRouter = t.router({
  config: configRouter,

  plexSections: t.procedure.query(async () => {
    const plexUrl = getConfig("plex_url");
    const plexToken = getConfig("plex_token");
    if (!plexUrl || !plexToken) {
      throw new Error("Plex URL and token are not configured");
    }
    const sectionsUrl = new URL("/library/sections", plexUrl);
    sectionsUrl.searchParams.set("X-Plex-Token", plexToken);
    const pRes = await fetch(sectionsUrl.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!pRes.ok) {
      throw new Error(`Plex returned ${pRes.status} ${pRes.statusText}`);
    }
    const data = await pRes.json();
    const directories: Array<{ key: string; title: string; type: string }> = data?.MediaContainer?.Directory || [];
    return directories.map((d) => ({
      key: d.key,
      title: d.title,
      type: d.type,
    }));
  }),

  testPlex: t.procedure
    .input(z.object({ plex_url: z.string(), plex_token: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const testUrl = new URL("/", input.plex_url);
        testUrl.searchParams.set("X-Plex-Token", input.plex_token);
        const pRes = await fetch(testUrl.toString(), {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10000),
        });
        if (!pRes.ok) {
          return {
            ok: false as const,
            error: `Plex returned ${pRes.status} ${pRes.statusText}`,
          };
        }
        const data = await pRes.json();
        const name = data?.MediaContainer?.friendlyName || "Unknown";
        return { ok: true as const, serverName: name };
      } catch (err) {
        return { ok: false as const, error: (err as Error).message };
      }
    }),
});

export type AppRouter = typeof appRouter;
