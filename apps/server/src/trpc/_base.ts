import { initTRPC } from "@trpc/server";
import { getConfig } from "../lib/config.ts";
import { createPlexClient } from "../clients/plex/index.ts";

export const t = initTRPC.create();

const logDuration = t.middleware(async ({ path, type, next }) => {
  const start = performance.now();
  const result = await next();
  const ms = (performance.now() - start).toFixed(1);
  console.log(`[trpc] ${type} ${path} — ${ms}ms`);
  return result;
});

export const procedure = t.procedure.use(logDuration);

export function getPlexClient() {
  const plexUrl = getConfig("global_plex_url");
  const plexToken = getConfig("global_plex_token");
  if (!plexUrl || !plexToken) {
    throw new Error("Plex URL and token are not configured");
  }
  return createPlexClient({ url: plexUrl, token: plexToken });
}
