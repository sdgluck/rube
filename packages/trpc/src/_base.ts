import { initTRPC, TRPCError } from "@trpc/server";
import type { Scope } from "@tinkerbell/container";
import { NotConfiguredError, runAsActor, type Clients } from "@tinkerbell/core";

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
  /** In-flight sign-in handshake nonce, from the handshake cookie. */
  handshakeNonce?: string;
  /**
   * This server's own origin as the caller reached it. The sign-in flow sends
   * the browser back here after Plex, and deriving it from the request rather
   * than accepting it as input means nobody can aim that return elsewhere.
   */
  origin: string;
  /** Best-effort client address, for rate-limiting the auth handshake. */
  ip: string;
  /** False when auth is switched off in config or bypassed by the env var. */
  authRequired: boolean;
  /**
   * The request's own container scope, disposed once the response is sent.
   *
   * Procedures take their domains from the router factory rather than from
   * here — a router is built once, exactly as the router object always was —
   * so this exists for anything genuinely per-request. Disposing it either way
   * means a scoped registration added later cannot leak.
   */
  scope: Scope;
}

export const t = initTRPC.context<AdminContext>().create();

/**
 * An unconfigured Plex is a state the user can fix in Settings, not a server
 * fault, so it answers 412 rather than 500. Core throws a plain
 * `NotConfiguredError` (it has no business knowing about HTTP); the mapping
 * happens here, at the transport boundary, matching the `PRECONDITION_FAILED`
 * that arr.router already uses for exactly this case.
 *
 * Every router binds its Plex client through this wrapper rather than calling
 * the injected factory directly, so the mapping covers all of them at once.
 */
export function mapNotConfiguredClient(clients: Clients): Clients["getPlexClient"] {
  return (...args) => {
    try {
      return clients.getPlexClient(...args);
    } catch (err) {
      if (err instanceof NotConfiguredError) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
      }
      throw err;
    }
  };
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

/**
 * Attribute everything this procedure does to the admin who called it.
 *
 * The change log wants a source and a username, and the chokepoints that
 * record — `setConfig`, `updateRule`, `updateJob` — are three layers below
 * here with no idea a request exists. Rather than thread an actor argument
 * through every one of them (and get it wrong at the call sites nobody
 * remembered), the actor is ambient for the duration of the call. See
 * `packages/core/src/actor.ts`.
 *
 * Applied to both procedure chains, not just the authenticated one: the
 * handshake mutations that switch admin auth on are exactly the writes whose
 * history matters most, and they necessarily run before there is a session.
 */
const attributeToCaller = t.middleware(({ ctx, next }) =>
  runAsActor({ source: "ui", username: ctx.session?.username ?? "" }, () => next()),
);

/** Authenticated. The default for every router. */
export const procedure = t.procedure.use(logDuration).use(mapNotConfigured).use(attributeToCaller).use(requireAdmin);

/**
 * Explicitly unauthenticated. Only the auth handshake and the status query
 * the SPA needs to decide which screen to render may use this — see the
 * enumeration test in `router-surface.test.ts`, which fails if the list of
 * public paths grows without someone saying so out loud.
 */
export const publicProcedure = t.procedure.use(logDuration).use(mapNotConfigured).use(attributeToCaller);
