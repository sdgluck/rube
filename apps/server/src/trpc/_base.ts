import { initTRPC } from "@trpc/server";

export { getPlexClient } from "@tinkerbell/core";

export const t = initTRPC.create();

const logDuration = t.middleware(async ({ path, type, next }) => {
  const start = performance.now();
  const result = await next();
  const ms = (performance.now() - start).toFixed(1);
  console.log(`[trpc] ${type} ${path} — ${ms}ms`);
  return result;
});

export const procedure = t.procedure.use(logDuration);
