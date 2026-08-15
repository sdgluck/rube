import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import type { AppRouter } from "@tinkerbell/trpc";

export const trpc = createTRPCReact<AppRouter>();

/**
 * Broadcast when the server answers 401. Handled in one place — `AuthGate`
 * re-reads the auth status and swaps in the sign-in screen — so a session
 * that expired mid-session produces one login prompt rather than a shower of
 * error toasts from whichever queries happened to be in flight.
 */
export const UNAUTHORIZED_EVENT = "tinkerbell:unauthorized";

const authAwareFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  return res;
};

export const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: (op) => op.path === "stats.sessions",
      true: httpLink({ url: "/api/trpc", fetch: authAwareFetch }),
      false: httpBatchLink({ url: "/api/trpc", fetch: authAwareFetch }),
    }),
  ],
});
