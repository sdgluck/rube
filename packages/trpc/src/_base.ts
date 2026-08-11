import { initTRPC, TRPCError } from "@trpc/server";
import { getPlexClient as getPlexClientUnmapped, NotConfiguredError } from "@tinkerbell/core";

export const t = initTRPC.create();

/**
 * An unconfigured Plex is a state the user can fix in Settings, not a server
 * fault, so it answers 412 rather than 500. Core throws a plain
 * `NotConfiguredError` (it has no business knowing about HTTP); the mapping
 * happens here, at the transport boundary, matching the `PRECONDITION_FAILED`
 * that arr.router already uses for exactly this case.
 *
 * Every router imports `getPlexClient` from this module rather than from core,
 * so wrapping the re-export covers all of them at once.
 */
export function getPlexClient(...args: Parameters<typeof getPlexClientUnmapped>) {
  try {
    return getPlexClientUnmapped(...args);
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
    }
    throw err;
  }
}

const logDuration = t.middleware(async ({ path, type, next }) => {
  const start = performance.now();
  const result = await next();
  const ms = (performance.now() - start).toFixed(1);
  console.log(`[trpc] ${type} ${path} — ${ms}ms`);
  return result;
});

/**
 * Domains call core's `getPlexClient` directly, so a `NotConfiguredError` can
 * still surface from below a procedure rather than from the wrapper above.
 * Catching it here means those routes answer 412 too instead of depending on
 * which layer happened to ask for the client.
 */
const mapNotConfigured = t.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
    }
    throw err;
  }
});

export const procedure = t.procedure.use(logDuration).use(mapNotConfigured);
