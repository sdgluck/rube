import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { PortalRouter } from "@tinkerbell/trpc";
import { apiUrl, authHeaders, getConnection } from "@tinkerbell/native-client";
import { activeGuestToken } from "./match/link.ts";

export const portalTrpc = createTRPCReact<PortalRouter>();

export const portalTrpcClient = portalTrpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      // Send/receive the session cookie in a browser. In the native app the
      // server is another origin, so the URL is made absolute and the session
      // travels as a bearer token instead — both resolved per request, since
      // the server is chosen and the session minted after this client exists.
      fetch: (url, opts) => {
        const headers = new Headers(opts?.headers);
        for (const [name, value] of Object.entries(authHeaders())) headers.set(name, value);
        // A movie-match guest's room token — see match/link.ts.
        const guest = activeGuestToken();
        if (guest) headers.set("X-Match-Guest", guest);
        // No cookies cross-origin: asking for them would need the server to
        // send `Access-Control-Allow-Credentials`, which it deliberately never
        // does (see apps/server/src/cors.ts), and the WebView would discard
        // every response.
        const credentials = getConnection() ? "omit" : "include";
        return fetch(typeof url === "string" ? apiUrl(url) : url, { ...opts, headers, credentials });
      },
    }),
  ],
});

/** One movie-match room, as its poll returns it. */
export type MatchState = inferRouterOutputs<PortalRouter>["match"]["state"];
export type MatchCard = inferRouterOutputs<PortalRouter>["match"]["deck"]["films"][number];
export type MatchFilm = MatchState["matches"][number];

/** Which tabs, sections and actions this server offers, by component id. */
export type PortalComponents = inferRouterOutputs<PortalRouter>["components"];
