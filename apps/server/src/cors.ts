/**
 * CORS for the native apps, and for nothing else.
 *
 * The browser SPAs are served by this process and never make a cross-origin
 * request, so until the native apps there was no CORS here at all. The
 * native apps bundle their UI and serve it from their own origin
 * (`capacitor://app.tinkerbell`, …), so every request they make is
 * cross-origin and the WebView blocks the response without these headers.
 *
 * A fixed list rather than `*` or an echo of whatever `Origin` arrived. The
 * apps authenticate with a bearer token, not a cookie, and no
 * `Access-Control-Allow-Credentials` is ever sent, so a wider policy would not
 * hand a hostile page anyone's session — but the agent API's own DNS-rebinding
 * argument (`packages/agent-api`) leans on cross-origin reads being refused,
 * and with auth switched off the admin API answers anyone who can reach it.
 * Letting any web page on the user's LAN read it via their browser is a
 * change nobody asked for, so only the two apps' origins get through.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

const ALLOW_HEADERS = "Authorization, Content-Type, Range";
const EXPOSE_HEADERS = "Content-Range, Content-Length, Content-Disposition, Accept-Ranges";
const ALLOW_METHODS = "GET, HEAD, POST, OPTIONS";

/**
 * Decorate the response for an allow-listed origin, and answer its preflight.
 * Returns true when the request was a preflight and has been answered.
 */
export function applyCors(req: IncomingMessage, res: ServerResponse, allowed: ReadonlySet<string>): boolean {
  const origin = req.headers.origin;
  // Caches must key on Origin, or a proxy could serve one origin's answer to the other.
  res.setHeader("Vary", "Origin");
  if (!origin || !allowed.has(origin)) return false;

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Expose-Headers", EXPOSE_HEADERS);

  if (req.method !== "OPTIONS") return false;
  res.writeHead(204, {
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    // The app usually reaches a server on the LAN. Chromium's Private Network
    // Access asks for this before letting a "public" origin talk to a private
    // address; harmless where it isn't enforced.
    ...(req.headers["access-control-request-private-network"] === "true"
      ? { "Access-Control-Allow-Private-Network": "true" }
      : {}),
    "Access-Control-Max-Age": "600",
    "Content-Length": "0",
  });
  res.end();
  return true;
}
