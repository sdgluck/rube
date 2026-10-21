import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { PortalRouter } from "@rube/trpc";
import { activeGuestToken } from "./match/link.ts";

export const portalTrpc = createTRPCReact<PortalRouter>();

export const portalTrpcClient = portalTrpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      // Send/receive the session cookie.
      fetch: (url, opts) => {
        const headers = new Headers(opts?.headers);
        // A movie-match guest's room token — see match/link.ts.
        const guest = activeGuestToken();
        if (guest) headers.set("X-Match-Guest", guest);
        return fetch(url, { ...opts, headers, credentials: "include" });
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
