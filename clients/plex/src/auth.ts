/**
 * Plex "Sign in with Plex" OAuth-style PIN flow (plex.tv). Unlike the rest of
 * this client these calls are unauthenticated bootstrap steps — they don't use
 * a server token — so they're plain functions rather than part of the client
 * factory.
 *
 * Flow: createPlexPin → redirect the user to buildPlexAuthUrl → poll
 * checkPlexPin until it returns a token → getPlexAccount to identify them.
 */
import { httpRequestJson } from "@tinkerbell/http";

const PLEX_TV = "https://plex.tv/api/v2";

function baseHeaders(clientId: string, product = "Tinkerbell"): Record<string, string> {
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

export async function createPlexPin(clientId: string, product = "Tinkerbell"): Promise<PlexPin> {
  const data = await httpRequestJson<{ id: number; code: string }>({
    url: `${PLEX_TV}/pins?strong=true`,
    init: { method: "POST", headers: baseHeaders(clientId, product) },
    timeoutMs: 15_000,
  });
  return { id: data.id, code: data.code };
}

export function buildPlexAuthUrl(opts: {
  clientId: string;
  code: string;
  product?: string;
  forwardUrl: string;
}): string {
  const params = new URLSearchParams({
    clientID: opts.clientId,
    code: opts.code,
    "context[device][product]": opts.product ?? "Tinkerbell",
    forwardUrl: opts.forwardUrl,
  });
  return `https://app.plex.tv/auth#?${params.toString()}`;
}

/** Poll a pin; returns the user auth token once they've authenticated, else null. */
export async function checkPlexPin(id: number, clientId: string): Promise<string | null> {
  const data = await httpRequestJson<{ authToken: string | null }>({
    url: `${PLEX_TV}/pins/${id}`,
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
    url: `${PLEX_TV}/user`,
    init: { method: "GET", headers: { ...baseHeaders(clientId), "X-Plex-Token": authToken } },
    timeoutMs: 15_000,
  });
  return { id: data.id, uuid: data.uuid, username: data.username, email: data.email, thumb: data.thumb };
}
