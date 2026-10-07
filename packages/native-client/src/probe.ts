/**
 * Ask a typed-in address whether it is a Tinkerbell this app can use.
 *
 * A plain GET of `auth.server` rather than a tRPC client: the picker runs
 * before there is a server to build a client for, and the answer has to be
 * judged before anything is saved.
 */
import { judgeServerInfo, serverCandidates, type ServerCheck, type ServerProduct } from "./server-url.ts";

const PROBE_TIMEOUT_MS = 8_000;

export async function probeServer(input: string, want: ServerProduct): Promise<ServerCheck> {
  const candidates = serverCandidates(input);
  if (!candidates.length) return { ok: false, reason: "unreachable", detail: "That isn't a web address." };

  // The most useful failure wins: "that's the portal" or "too old" beats the
  // https candidate's "unreachable" on a server that only speaks http.
  let best: ServerCheck = { ok: false, reason: "unreachable" };
  for (const server of candidates) {
    let body: unknown;
    try {
      const res = await fetch(`${server}/api/trpc/auth.server`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      body = await res.json();
    } catch (err) {
      if (best.ok === false && best.reason === "unreachable") {
        best = { ok: false, reason: "unreachable", detail: err instanceof Error ? err.message : String(err) };
      }
      continue;
    }
    const check = judgeServerInfo(server, body, want);
    if (check.ok) return check;
    best = check;
  }
  return best;
}
