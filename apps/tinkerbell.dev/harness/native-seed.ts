/**
 * What `native-serve.ts` adds on top of the demo seed: admin sign-in on, the
 * portal open, and the owner a user of the portal too, so one sign-in in the
 * simulator reaches both parts of the app.
 *
 * The owner token hash is left unset on purpose. The server resolves the owner
 * by asking (mock) plex.tv about the seeded token the first time anyone signs
 * in — the same path a real install takes — rather than this seed asserting
 * an answer the server would never have looked up.
 */
import { createDb, defaultDataDir, plexUsers } from "@tinkerbell/db";
import { createConfigStore } from "@tinkerbell/core";
import { FIXED_NOW } from "./clock.ts";

const db = createDb({ dataDir: defaultDataDir() });
const { setConfig } = createConfigStore({ db, recordChange: () => {} });

setConfig("admin_auth_enabled", true);
// Either of these opens the portal (`portalShouldRun`); both have tabs to show.
setConfig("match_enabled", true);
setConfig("cleanup_enabled", true);
if (process.env.NATIVE_PORTAL_URL) setConfig("user_app_public_url", process.env.NATIVE_PORTAL_URL);

db.insert(plexUsers)
  .values({ userId: 1, username: "owner", name: "Owner", label: "User:Owner", syncedAt: FIXED_NOW })
  .onConflictDoNothing()
  .run();
