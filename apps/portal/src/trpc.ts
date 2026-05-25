import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
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
