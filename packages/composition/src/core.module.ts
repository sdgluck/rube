/**
 * Infrastructure and `@tinkerbell/core` registrations.
 *
 * Split from the domain registrations so a test — or the migrator, or any
 * future entrypoint that has no business standing up 29 domains — can build a
 * container with just the database, config and clients in it.
 *
 * Note what registration order does NOT do here: nothing is constructed while
 * this function runs, so `createClients` may name `HealthReporterToken` even
 * though the health domain registers it in a different module, later. The graph
 * is declared here and resolved on demand.
 */
import type { Registry } from "@tinkerbell/container";
import { closeDb, createDb, defaultDataDir, DbToken } from "@tinkerbell/db";
import { ChangeRecorderToken, HealthReporterToken } from "@tinkerbell/ports";
import {
  AdminAuthToken,
  ArrInstancesToken,
  ClientsToken,
  ConfigStoreToken,
  createAdminAuth,
  createArrInstances,
  createClients,
  createConfigStore,
  createPosterCacheAt,
  createPosters,
  createPreferences,
  createSessions,
  createSharing,
  PosterCacheToken,
  PostersToken,
  PreferencesToken,
  SessionsToken,
  SharingToken,
} from "@tinkerbell/core";

export interface CoreEnv {
  /** Where `tinkerbell.db` and the poster cache live. */
  dataDir?: string;
  /** Process start, for uptime. Passed in so a test can pin it. */
  startedAt?: number;
}

export function registerCore(r: Registry, env: CoreEnv = {}): void {
  const dataDir = env.dataDir ?? defaultDataDir();

  // The connection, and the disposer that closes it. This is the registration
  // that replaces the import-time `new Database(...)` in `@tinkerbell/db` —
  // and the reason a test can now have two of these at once.
  r.register(DbToken, () => createDb({ dataDir }), { dispose: closeDb });

  // `ChangeRecorderToken` is provided by `domains/config-history`, which sits
  // above core — the same shape as `HealthReporterToken` below, and named here
  // for the same reason: a container assembled without a recorder fails to
  // resolve rather than quietly keeping no settings history.
  r.register(ConfigStoreToken, (c) =>
    createConfigStore({ db: c.resolve(DbToken), recordChange: c.resolve(ChangeRecorderToken) }),
  );
  r.register(SharingToken, (c) => createSharing({ db: c.resolve(DbToken) }));
  r.register(PreferencesToken, (c) => createPreferences({ db: c.resolve(DbToken) }));
  r.register(ArrInstancesToken, (c) => createArrInstances({ config: c.resolve(ConfigStoreToken) }));

  r.register(SessionsToken, (c) => createSessions({ db: c.resolve(DbToken), config: c.resolve(ConfigStoreToken) }));
  r.register(AdminAuthToken, (c) =>
    createAdminAuth({ config: c.resolve(ConfigStoreToken), sessions: c.resolve(SessionsToken) }),
  );

  r.register(PosterCacheToken, () => createPosterCacheAt());
  r.register(PostersToken, (c) =>
    createPosters({ config: c.resolve(ConfigStoreToken), cache: c.resolve(PosterCacheToken) }),
  );

  // `HealthReporterToken` is provided by `domains/health`. Naming it here is
  // the whole point: the client factories declare that they report health, and
  // a container assembled without a reporter fails to resolve rather than
  // quietly reporting to nobody, which is what `setHealthReporter`'s no-op
  // default did for every job in a Sidequest worker.
  r.register(ClientsToken, (c) =>
    createClients({
      config: c.resolve(ConfigStoreToken),
      health: c.resolve(HealthReporterToken),
      db: c.resolve(DbToken),
    }),
  );
}
