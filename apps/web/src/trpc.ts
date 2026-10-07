import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import type { AppRouter } from "@tinkerbell/trpc";
import { apiUrl, authHeaders } from "@tinkerbell/native-client";

export const trpc = createTRPCReact<AppRouter>();

/**
 * Broadcast when the server answers 401. Handled in one place — `AuthGate`
 * re-reads the auth status and swaps in the sign-in screen — so a session
 * that expired mid-session produces one login prompt rather than a shower of
 * error toasts from whichever queries happened to be in flight.
 */
export const UNAUTHORIZED_EVENT = "tinkerbell:unauthorized";

const authAwareFetch: typeof fetch = async (input, init) => {
  // Resolved per request rather than baked into the links: in the native app
  // the server is chosen at runtime and the bearer token arrives after sign-in.
  // In a browser both are no-ops and this is the request it always was.
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(authHeaders())) headers.set(name, value);
  const res = await fetch(typeof input === "string" ? apiUrl(input) : input, { ...init, headers });
  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok && !res.headers.get("content-type")?.includes("json")) throw new Error(notTinkerbellMessage(res));
  return res;
};

/**
 * Tinkerbell always answers tRPC in JSON, so an error that isn't JSON came from
 * something in front of it — a reverse proxy's 502/504 page, typically. Left
 * to tRPC that surfaced as `Unexpected token '<', "<html>"… is not valid JSON`,
 * which names neither the status nor who sent it.
 */
function notTinkerbellMessage(res: Pick<Response, "status" | "statusText">): string {
  const status = `${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
  const why =
    res.status === 504 || res.status === 524
      ? "a proxy in front of Tinkerbell gave up waiting for it"
      : res.status === 502 || res.status === 503
        ? "a proxy in front of Tinkerbell couldn't reach it — is the server running?"
        : "the reply came from something other than Tinkerbell";
  return `The server answered ${status} — ${why}.`;
}

export const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: (op) => op.path === "stats.sessions",
      true: httpLink({ url: "/api/trpc", fetch: authAwareFetch }),
      false: httpBatchLink({ url: "/api/trpc", fetch: authAwareFetch }),
    }),
  ],
});
