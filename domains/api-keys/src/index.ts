/* ─── Keys for the agent API ────────────────────────────────────────────────
 *
 * The admin app authenticates with a Plex session cookie, which an AI client
 * cannot hold: there is no browser to complete the PIN handshake in, and a
 * cookie copied out of one would carry full admin rights for a week. So the
 * agent API (`/mcp`, `/api/v1`) has its own credential — a bearer key, named,
 * revocable one at a time, and good only for the read-only surface.
 *
 * Required whether or not admin auth is on. With admin auth off the tRPC API is
 * open to anyone who can reach the port, and it would be easy to argue the
 * agent API may as well be too; but a key is the only thing that tells the
 * user *which* client asked, and an endpoint that answers "everything about
 * this server" to anonymous callers is not one that should exist by default.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { apiKeys, type Db } from "@rube/db";
import { token } from "@rube/container";
import type { Clock } from "@rube/ports";

/**
 * Recognisable in a config file or a leaked log line, which is the point:
 * secret scanners match on prefixes, and so do people.
 */
export const API_KEY_PREFIX = "tbk_";

/** How much of the key the list shows — enough to tell two apart, nowhere near enough to use. */
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 6;

/**
 * `lastUsedAt` is for "is anything still using this key?", which minute
 * resolution answers. Writing it on every request would turn an agent's burst
 * of twenty tool calls into twenty WAL writes for no extra information.
 */
const LAST_USED_RESOLUTION_MS = 60_000;

export const API_KEY_NAME_MAX = 60;

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface ApiKeyIdentity {
  id: string;
  name: string;
}

export interface ApiKeysDeps {
  db: Db;
  now: Clock;
}

/**
 * One unsalted SHA-256, deliberately — not bcrypt/scrypt. Those exist to make
 * guessing a low-entropy human password expensive; this key is 32 random
 * bytes, so there is nothing to guess, and a slow KDF would only add its cost
 * to every agent request. Unsalted because the hash is the lookup key: the
 * presented key is hashed and found by equality. CodeQL's
 * js/insufficient-password-hash flags it from the `API_KEY` name alone.
 */
function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function createApiKeys(deps: ApiKeysDeps) {
  const { db, now } = deps;

  function listApiKeys(): ApiKeySummary[] {
    return db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
      })
      .from(apiKeys)
      .orderBy(desc(apiKeys.createdAt))
      .all();
  }

  /**
   * Mint a key. The raw value is returned exactly once — only its hash is
   * kept, so the caller must show it now or it is gone.
   */
  function createApiKey(name: string): ApiKeySummary & { key: string } {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Give the key a name, so you can tell it apart later.");
    if (trimmed.length > API_KEY_NAME_MAX) throw new Error(`Keep the name under ${API_KEY_NAME_MAX} characters.`);

    const key = API_KEY_PREFIX + randomBytes(32).toString("base64url");
    const row = {
      id: randomUUID(),
      name: trimmed,
      keyHash: hashKey(key),
      prefix: key.slice(0, DISPLAY_PREFIX_LENGTH),
      createdAt: now(),
      lastUsedAt: null,
    };
    db.insert(apiKeys).values(row).run();
    const { keyHash: _hash, ...summary } = row;
    return { ...summary, key };
  }

  /** Returns the revoked key's name, or null if there was no such key. */
  function revokeApiKey(id: string): string | null {
    const row = db.select({ name: apiKeys.name }).from(apiKeys).where(eq(apiKeys.id, id)).get();
    if (!row) return null;
    db.delete(apiKeys).where(eq(apiKeys.id, id)).run();
    return row.name;
  }

  /**
   * Who a presented key belongs to, or undefined.
   *
   * Looked up by hash, so there is no string comparison against a secret to
   * time: the database either has a row with this digest or it doesn't.
   */
  function verifyApiKey(raw: string | undefined | null): ApiKeyIdentity | undefined {
    if (!raw || !raw.startsWith(API_KEY_PREFIX)) return undefined;
    const row = db
      .select({ id: apiKeys.id, name: apiKeys.name, lastUsedAt: apiKeys.lastUsedAt })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, hashKey(raw)))
      .get();
    if (!row) return undefined;

    const at = now();
    if (row.lastUsedAt === null || at - row.lastUsedAt >= LAST_USED_RESOLUTION_MS) {
      db.update(apiKeys).set({ lastUsedAt: at }).where(eq(apiKeys.id, row.id)).run();
    }
    return { id: row.id, name: row.name };
  }

  return { listApiKeys, createApiKey, revokeApiKey, verifyApiKey };
}

export type ApiKeys = ReturnType<typeof createApiKeys>;
export const ApiKeysToken = token<ApiKeys>("apiKeys");
