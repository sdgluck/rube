import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTrpc } from "@tinkerbell/trpc";
import { buildContainer, ServicesToken } from "@tinkerbell/composition";
import { JobsToken, registerJobs, stopSidequest, stopStressTest } from "@tinkerbell/jobs";
import { authDisabledByEnv, createLogger, errorMessage, startAuthDisabledWarning } from "@tinkerbell/core";
import { createAuth } from "./auth.ts";
import { createAdminHandler, createPortalHandler } from "./handlers.ts";
import { createCollectionRoutes } from "./collections.ts";
import { createPrerollRoutes } from "./prerolls.ts";
import { createPortabilityRoutes } from "./portability.ts";
import { guarded } from "./http.ts";

const log = createLogger("server");

/**
 * This build's version, read from the package the server ships as.
 *
 * Stamped into an export so a bundle says which Tinkerbell wrote it — the
 * first question anybody asks about a file that won't import. The release
 * script keeps every workspace package's version in step, so this is the
 * app version rather than one package's.
 */
const APP_VERSION: string = JSON.parse(await readFile(join(import.meta.dirname, "..", "package.json"), "utf8")).version;
const portalLog = createLogger("portal");

// The application graph. One call, and the same call the Sidequest worker
// makes — which is the point. This used to be `registerCoreHooks()`, four
// assignments to mutable module-level slots that each defaulted to a no-op, so
// an entrypoint that forgot it (the worker did, for as long as jobs existed)
// got a server that started cleanly and silently did nothing for health
// reports, notification traces, migration rescans and collection counts.
const container = buildContainer({}, [registerJobs]);
const services = container.resolve(ServicesToken);
const jobs = container.resolve(JobsToken);
const { initJobs } = jobs;

const { appRouter, portalRouter, createAdminContext, createPortalContext } = createTrpc({ ...services, jobs });
const { rejectIfNotAdmin } = createAuth(services);
const { handleCollectionRoute } = createCollectionRoutes(services);
const { handlePrerollRoute } = createPrerollRoutes({ ...services, jobs });
const { handlePortabilityRoute } = createPortabilityRoutes({ ...services, version: APP_VERSION });
const { getConfig, portalShouldRun } = services.config;
const { adminAuthRequired } = services.adminAuth;

const PORT = parseInt(process.env.PORT || "3000", 10);
// Bind to loopback by default. Admin auth exists now (Settings → Security) but
// is off until somebody turns it on, and an upgrade never turns it on for them —
// so the default has to assume it is off, in which case anyone who can reach the
// port can call every tRPC mutation. The Docker image sets HOST=0.0.0.0 because
// the container must be reachable from outside, and trusts the user to put it
// behind a reverse proxy / firewall.
const HOST = process.env.HOST || "127.0.0.1";
// The user portal (Sign-in-with-Plex). Served on its own port so it can be
// exposed publicly without exposing the admin API, which may or may not require
// a sign-in. Defaults to loopback like the admin server; the Docker image opens
// this one to the host.
const USER_PORT = parseInt(process.env.USER_PORT || "3100", 10);
const USER_HOST = process.env.USER_HOST || HOST;
// The address to print at boot. `api.tinkerbell.localhost` is the localias
// proxy from `pnpm dev` and resolves nowhere else, so it is dev-only — in a
// container it sent people to a hostname their browser can't resolve. A
// wildcard bind isn't a dialable host either, so report loopback for those.
function listenUrl(): string {
  if (process.env.NODE_ENV !== "production") return "https://api.tinkerbell.localhost";
  const host = HOST === "0.0.0.0" || HOST === "::" ? "localhost" : HOST;
  return `http://${host.includes(":") ? `[${host}]` : host}:${PORT}`;
}

const DIST_DIR = join(import.meta.dirname, "..", "..", "web", "dist");
const PORTAL_DIST_DIR = join(import.meta.dirname, "..", "..", "portal", "dist");

const server = createServer(
  guarded(
    log,
    createAdminHandler({
      rejectIfNotAdmin,
      getConfig,
      handlePrerollRoute,
      handlePortabilityRoute,
      handleCollectionRoute,
      appRouter,
      createAdminContext,
      distDir: DIST_DIR,
    }),
  ),
);

// User portal server: only the session-gated portalRouter + the portal SPA.
// The admin appRouter is intentionally NOT mounted here, so even though it is
// unauthenticated it stays unreachable on the public port.
const portalServer = createServer(
  guarded(portalLog, createPortalHandler({ portalRouter, createPortalContext, portalDistDir: PORTAL_DIST_DIR })),
);

// Keep listening even if a bind fails (e.g. port in use) — the reconciler
// retries on its interval rather than crashing the admin server.
portalServer.on("error", (err) => {
  portalLog.error("server error", { err: errorMessage(err) });
});

const PORTAL_RECONCILE_MS = 15_000;

// The portal runs while any feature it serves is on — personalization, cleanup
// warnings, or digests (see `portalShouldRun`). Those switches flip in jobs and
// in Settings rather than here, so we poll and start/stop accordingly.
function syncPortalServer(): void {
  const shouldRun = portalShouldRun();
  if (shouldRun && !portalServer.listening) {
    portalServer.listen(USER_PORT, USER_HOST, () => {
      portalLog.info("listening", { host: USER_HOST, port: USER_PORT });
    });
  } else if (!shouldRun && portalServer.listening) {
    portalServer.close(() => portalLog.info("stopped — no portal feature is enabled"));
  }
}

async function main() {
  // Finish boot before we accept any traffic. If init fails we want clean
  // "connection refused" rather than half-initialised tRPC handlers, and a
  // crash should happen before the port opens.
  try {
    services.overlays.ensureBuiltInPresets();
  } catch (err) {
    log.error("failed to seed built-in overlay presets", { err: errorMessage(err) });
  }
  try {
    await initJobs();
  } catch (err) {
    log.error("job init failed", { err: errorMessage(err) });
    process.exit(1);
  }
  startAuthDisabledWarning();
  server.listen(PORT, HOST, () => {
    log.info("admin server listening", { host: HOST, port: PORT, url: listenUrl() });
    const loopback = HOST === "127.0.0.1" || HOST === "localhost" || HOST === "::1";
    if (adminAuthRequired()) {
      log.info("admin authentication is active — sign in with the Plex server owner's account");
    } else if (!loopback) {
      // The combination that stays genuinely dangerous, and keeps saying so:
      // reachable from the network with nothing checking who's calling.
      log.warn(
        `Listening on ${HOST}: every tRPC mutation is reachable without authentication` +
          (authDisabledByEnv() ? " (TINKERBELL_DISABLE_AUTH is set)" : "") +
          `. Only expose this port to networks you trust, or enable admin authentication in the app.`,
      );
    }
  });
  // Start the portal only if personalization is already enabled, and keep it
  // in sync with the master switch thereafter.
  syncPortalServer();
  setInterval(syncPortalServer, PORTAL_RECONCILE_MS).unref();
}

main().catch((err) => {
  log.error("unhandled error during startup", { err: errorMessage(err) });
  process.exit(1);
});

const SHUTDOWN_GRACE_MS = 10_000;

let shuttingDown = false;
async function shutdown() {
  // Two signals = exit now. Container orchestrators send SIGTERM, wait,
  // then SIGKILL, and a human pressing Ctrl-C twice means "I'm impatient".
  if (shuttingDown) process.exit(0);
  shuttingDown = true;

  await stopSidequest();

  // A forked child is not killed with its parent, so without this a restart
  // leaves a stress test pulling streams off the user's Plex server with
  // nothing left running that knows about it.
  stopStressTest();

  // Stop accepting new connections, then wait up to SHUTDOWN_GRACE_MS for
  // in-flight requests (streaming Plex images, large tRPC responses) to
  // drain. Force-close anything still hanging so we don't block the
  // container exit forever.
  const closed = Promise.all([
    new Promise<void>((resolve) => server.close(() => resolve())),
    new Promise<void>((resolve) => portalServer.close(() => resolve())),
  ]);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS).unref());
  await Promise.race([closed, timeout]);
  server.closeAllConnections();
  portalServer.closeAllConnections();

  // Closes the SQLite handle and anything else the graph registered a disposer
  // for. Previously nothing closed the connection at all — the process simply
  // exited and left it to the OS.
  await container.dispose();

  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// On modern Node an unhandled rejection terminates the process with no
// context. There are fire-and-forget call sites (preroll processing, the BYW
// uninstall cleanup) where a future edit could easily introduce one, and
// "container died, no log line" is the worst possible failure mode on a home
// server.
process.on("unhandledRejection", (reason) => {
  log.error("unhandled promise rejection", { err: errorMessage(reason) });
});

// Exiting here is deliberate: the process is in an unknown state, and the
// Docker restart policy is a better recovery mechanism than carrying on.
process.on("uncaughtException", (err) => {
  log.error("uncaught exception — exiting for restart", { err: errorMessage(err) });
  process.exit(1);
});
