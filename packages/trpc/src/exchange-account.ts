/**
 * The Plex account behind the token a native app hands `auth.exchange`.
 *
 * plex.tv answers a token it doesn't recognise with a 401, which
 * `httpRequestJson` throws as an `HttpError`, and tRPC turns any unmapped throw
 * into a 500. The app reads a 500 as "this server is broken", not "sign in
 * again", so a stale or mangled token has to come back as UNAUTHORIZED. Any
 * other failure (plex.tv down, a timeout) is still the server's problem and
 * stays an error.
 */
import { TRPCError } from "@trpc/server";
import { HttpError } from "@tinkerbell/http";
import { getPlexAccount, type PlexUserAccount } from "@tinkerbell/plex";

export async function exchangeAccount(plexToken: string, clientId: string): Promise<PlexUserAccount> {
  try {
    return await getPlexAccount(plexToken, clientId);
  } catch (err) {
    if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Plex didn't accept that sign-in. Try signing in again." });
    }
    throw err;
  }
}
