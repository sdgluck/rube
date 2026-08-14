import { initTRPC, TRPCError } from "@trpc/server";
import { getPlexClient as getPlexClientUnmapped, NotConfiguredError } from "@tinkerbell/core";

/**
 * What every admin procedure can see about its caller. Populated by
 * `createAdminContext` (see `admin-auth.router.ts`); the fetch adapter builds
 * one per request.
 */
export interface AdminContext {
  session?: { userId: number; username: string };
  rawToken?: string;
  resHeaders: Headers;
  /** True when the request arrived over HTTPS, so cookies can be `Secure`. */
  secure: boolean;
  /** Best-effort client address, for rate-limiting the auth handshake. */
  ip: string;
  /** False when auth is switched off in config or bypassed by the env var. */
  authRequired: boolean;
}

export const t = initTRPC.context<AdminContext>().create();

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

/**
 * The admin gate.
 *
 * Note which way round this is: the ubiquitous `procedure` every router
 * already imports is the *authenticated* one, and staying public takes a
 * deliberate `publicProcedure`. If the gate were opt-in, one router written
 * six months from now that forgets it is a silent full bypass; opt-out, the
 * worst a forgotten annotation can do is show a login prompt where none was
 * wanted, which is visible and harmless.
 */
const requireAdmin = t.middleware(({ ctx, next }) => {
  if (!ctx.authRequired) return next();
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue." });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

/** Authenticated. The default for every router. */
export const procedure = t.procedure.use(logDuration).use(mapNotConfigured).use(requireAdmin);

/**
 * Explicitly unauthenticated. Only the auth handshake and the status query
 * the SPA needs to decide which screen to render may use this — see the
 * enumeration test in `router-surface.test.ts`, which fails if the list of
 * public paths grows without someone saying so out loud.
 */
export const publicProcedure = t.procedure.use(logDuration).use(mapNotConfigured);
