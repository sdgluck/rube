/**
 * Tell a web page's request from a native app's, for `auth.exchange`.
 *
 * The exchange hands a session token back in the response body. That is fine
 * for URLSession and OkHttp, which keep it in the Keychain/Keystore, and wrong
 * for a browser, where the same body is readable by page script — the reason
 * the browser sign-in keeps its session in an HttpOnly cookie. A page that got
 * hold of someone's Plex token could otherwise mint itself a session.
 *
 * Browsers attach `Origin` to every cross-origin fetch (and to same-origin
 * POSTs) and `Sec-Fetch-Site` to every request, and script can't remove
 * either. Native HTTP stacks send neither. A non-browser client could forge
 * their absence, but such a client could equally run the PIN flow itself; the
 * property protected here is only "no page script reads a session".
 */
import { TRPCError } from "@trpc/server";

export function isBrowserRequest(req: Request): boolean {
  return req.headers.has("origin") || req.headers.has("sec-fetch-site");
}

export function refuseBrowser(fromBrowser: boolean | undefined): void {
  if (fromBrowser) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This sign-in is for the Rube app only." });
  }
}
