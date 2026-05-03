import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import type { AppRouter } from "../../server/src/trpc.ts";

export const trpc = createTRPCReact<AppRouter>();

export const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: (op) => op.path === "stats.sessions",
      true: httpLink({ url: "/api/trpc" }),
      false: httpBatchLink({ url: "/api/trpc" }),
    }),
  ],
});
