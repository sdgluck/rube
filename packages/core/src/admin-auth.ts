/**
 * Who counts as an admin, and whether the admin API is gated at all.
 *
 * Identity is the Plex server owner rather than a username/password
 * Rube invents: the app is useless without a Plex token anyway, the
 * owner is unambiguously identifiable from that token, and it means no
 * password storage, no reset flow, and no email.
 *
 * The owner id is resolved from `global_plex_token` via plex.tv and cached in
 * config, keyed by a hash of the token it came from. Caching matters for
 * availability — plex.tv being unreachable must not lock the owner out of a
 * server they're already holding a valid cookie for — and the token hash is
 * what keeps the cache honest when the token is rotated to a different
 * account.
 */
import { createHash } from "node:crypto";
import { token as containerToken } from "@rube/container";
import { getPlexAccount } from "@rube/plex";
import type { ConfigStore } from "./config.ts";
import type { Sessions } from "./sessions.ts";

import { createLogger } from "./logger.ts";

const log = createLogger("auth");

/**
 * The escape hatch for anyone who locks themselves out — a rotated token, a
 * plex.tv outage, the wrong account. It requires shell access to the host,
 * which is the right bar for "let me back in", and it's the same shape as the
 * existing `HOST` override.
 */
export function authDisabledByEnv(): boolean {
  const raw = (process.env.RUBE_DISABLE_AUTH ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

const DISABLED_WARNING_MS = 60_000;

/**
 * While the escape hatch is set, say so every minute. A bypass you forgot you
 * turned on is worse than no auth at all, because you believe you have some.
 */
export function startAuthDisabledWarning(): void {
  if (!authDisabledByEnv()) return;
  const warn = () =>
    log.warn(
      "RUBE_DISABLE_AUTH is set: the admin API is reachable without signing in. " +
        "Unset it and restart once you can sign in again.",
    );
  warn();
  setInterval(warn, DISABLED_WARNING_MS).unref();
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface OwnerAccount {
  userId: number;
  username: string;
}

/**
 * Thrown when the owner can't be determined. Auth cannot be enabled without
 * an owner — failing closed here means "you can't turn it on yet", which is
 * recoverable, rather than "everyone is an admin", which isn't.
 */
export class OwnerUnresolvedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerUnresolvedError";
  }
}

export interface AdminAuthDeps {
  config: ConfigStore;
  sessions: Sessions;
}

export function createAdminAuth(deps: AdminAuthDeps) {
  const { getConfig, setConfig } = deps.config;
  const { ensurePlexClientId } = deps.sessions;

  /** True when the admin switch is on in config, regardless of the env bypass. */
  function adminAuthConfigured(): boolean {
    return getConfig("admin_auth_enabled") === true;
  }

  /** True when calls must actually carry an admin session. */
  function adminAuthRequired(): boolean {
    return adminAuthConfigured() && !authDisabledByEnv();
  }

  /**
   * The cached owner, or undefined if it was never resolved or the Plex token
   * has changed since. Synchronous and offline — this is what the request path
   * uses.
   */
  function cachedOwner(): OwnerAccount | undefined {
    const userId = getConfig("global_plex_owner_id");
    const username = getConfig("global_plex_owner_username");
    if (userId === undefined) return undefined;
    const token = getConfig("global_plex_token");
    const storedHash = getConfig("global_plex_owner_token_hash");
    // A token change invalidates the cache: the new token may belong to a
    // different account, and admitting the previous owner on the strength of a
    // stale lookup is precisely the failure this guards against.
    //
    // A *missing* hash fails closed too. `resolveOwner` always writes the id and
    // the hash together, so an id standing on its own didn't come from there —
    // it was written directly, and an unbound owner id is a standing admin grant
    // for whoever chose it.
    if (!token || !storedHash || tokenHash(token) !== storedHash) return undefined;
    return { userId, username: username ?? "owner" };
  }

  /**
   * Resolve (and cache) the Plex account behind the configured server token.
   * The server token is the owner's own account token, so plex.tv's account
   * endpoint answers this directly.
   */
  async function resolveOwner(opts: { force?: boolean } = {}): Promise<OwnerAccount> {
    if (!opts.force) {
      const cached = cachedOwner();
      if (cached) return cached;
    }

    const token = getConfig("global_plex_token");
    if (!token) {
      throw new OwnerUnresolvedError(
        "No Plex token is configured, so Rube can't tell who owns this server. Add one in Settings → Plex first.",
      );
    }

    let account;
    try {
      account = await getPlexAccount(token, ensurePlexClientId());
    } catch (err) {
      throw new OwnerUnresolvedError(
        `Couldn't ask plex.tv who owns this server: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!account?.id) {
      throw new OwnerUnresolvedError("plex.tv didn't return an account id for the configured Plex token.");
    }

    setConfig("global_plex_owner_id", account.id);
    setConfig("global_plex_owner_username", account.username);
    setConfig("global_plex_owner_token_hash", tokenHash(token));
    log.info("resolved Plex server owner", { userId: account.id, username: account.username });
    return { userId: account.id, username: account.username };
  }

  /**
   * Whether a signed-in Plex account may use the admin API. The owner always
   * may; anyone else only if the owner explicitly allow-listed them.
   */
  function isAdminAccount(userId: number): boolean {
    const owner = cachedOwner();
    if (owner && owner.userId === userId) return true;
    return (getConfig("admin_allowed_user_ids") ?? []).includes(userId);
  }

  return { adminAuthConfigured, adminAuthRequired, cachedOwner, resolveOwner, isAdminAccount };
}

export type AdminAuth = ReturnType<typeof createAdminAuth>;

export const AdminAuthToken = containerToken<AdminAuth>("adminAuth");
