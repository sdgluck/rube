/**
 * Plex "Sign in with Plex" OAuth-style PIN flow (plex.tv). Unlike the rest of
 * this client these calls are unauthenticated bootstrap steps — they don't use
 * a server token — so they're plain functions rather than part of the client
 * factory.
 *
 * Flow: createPlexPin → redirect the user to buildPlexAuthUrl → poll
 * checkPlexPin until it returns a token → getPlexAccount to identify them.
 */
import { httpRequestJson } from "@rube/http";

/**
 * plex.tv, unless a development build points it at the mock in
 * `@rube/test-support/plex-tv` — the native apps' sign-in can't be
 * exercised end to end against the real one without a real account approving
 * every run. Ignored in production, where an env var redirecting the identity
 * provider would be a way to mint any session at all.
 */
function plexTv(): string {
  const override = process.env.RUBE_PLEX_TV_URL;
  if (override && process.env.NODE_ENV !== "production") return `${override.replace(/\/+$/, "")}/api/v2`;
  return "https://plex.tv/api/v2";
}

function baseHeaders(clientId: string, product = "Rube"): Record<string, string> {
  return {
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Product": product,
    Accept: "application/json",
  };
}

export interface PlexPin {
  id: number;
  code: string;
}

export async function createPlexPin(clientId: string, product = "Rube"): Promise<PlexPin> {
  const data = await httpRequestJson<{ id: number; code: string }>({
    url: `${plexTv()}/pins?strong=true`,
    init: { method: "POST", headers: baseHeaders(clientId, product) },
    timeoutMs: 15_000,
  });
  return { id: data.id, code: data.code };
}

export function buildPlexAuthUrl(opts: {
  clientId: string;
  code: string;
  product?: string;
  /**
   * Where plex.tv sends the browser after approval. Omitted for the native
   * apps: they open plex.tv in an in-app browser sheet and close it themselves
   * once the poll succeeds, so there is nowhere to return to — and a return to
   * the server's web UI would strand the user outside the app.
   */
  forwardUrl?: string;
}): string {
  const params = new URLSearchParams({
    clientID: opts.clientId,
    code: opts.code,
    "context[device][product]": opts.product ?? "Rube",
  });
  if (opts.forwardUrl) params.set("forwardUrl", opts.forwardUrl);
  return `https://app.plex.tv/auth#?${params.toString()}`;
}

/** Poll a pin; returns the user auth token once they've authenticated, else null. */
export async function checkPlexPin(id: number, clientId: string): Promise<string | null> {
  const data = await httpRequestJson<{ authToken: string | null }>({
    url: `${plexTv()}/pins/${id}`,
    init: { method: "GET", headers: baseHeaders(clientId) },
    timeoutMs: 15_000,
  });
  return data.authToken || null;
}

export interface PlexUserAccount {
  id: number;
  uuid: string;
  username: string;
  email?: string;
  thumb?: string;
}

/** Resolve the identity behind a user auth token via plex.tv. */
export async function getPlexAccount(authToken: string, clientId: string): Promise<PlexUserAccount> {
  const data = await httpRequestJson<PlexUserAccount>({
    url: `${plexTv()}/user`,
    init: { method: "GET", headers: { ...baseHeaders(clientId), "X-Plex-Token": authToken } },
    timeoutMs: 15_000,
  });
  return { id: data.id, uuid: data.uuid, username: data.username, email: data.email, thumb: data.thumb };
}
