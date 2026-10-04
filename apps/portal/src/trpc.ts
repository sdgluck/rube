import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { PortalRouter } from "@tinkerbell/trpc";

export const portalTrpc = createTRPCReact<PortalRouter>();

export const portalTrpcClient = portalTrpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      // Send/receive the session cookie.
      fetch: (url, opts) => fetch(url, { ...opts, credentials: "include" }),
    }),
  ],
});

/** Which tabs, sections and actions this server offers, by component id. */
export type PortalComponents = inferRouterOutputs<PortalRouter>["components"];
