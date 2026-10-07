/**
 * Sign in with Plex from inside the app.
 *
 * The browser SPA navigates the whole tab to plex.tv and comes back via
 * `forwardUrl`. In the app that would leave the app for the server's web UI
 * and never come back, so instead plex.tv opens in an in-app browser sheet
 * (SFSafariViewController / Custom Tab), the app polls with the handshake
 * nonce the server gave it, and closes the sheet itself once the PIN is
 * approved. The session comes back in the poll's body — the server only does
 * that for a handshake that began as native (see `handshake.ts`).
 *
 * Takes the two calls as functions rather than a tRPC client, because the
 * admin and portal routers are different types and this package can't depend
 * on either app.
 */
import { Browser } from "@capacitor/browser";

export interface NativeSignInCalls {
  start: () => Promise<{ authUrl: string; handshake?: string }>;
  poll: (handshake: string) => Promise<{ status: "ok" | "pending" | "expired"; token?: string; username?: string }>;
}

const POLL_INTERVAL_MS = 2_000;
/** Matches the server's 15-minute handshake. */
const MAX_POLLS = 450;
/** After the user closes the sheet: approving and then closing at once is common. */
const POLLS_AFTER_CLOSE = 3;

export class SignInCancelled extends Error {
  constructor() {
    super("Sign-in was cancelled.");
  }
}

export async function nativePlexSignIn(calls: NativeSignInCalls): Promise<{ token: string; username?: string }> {
  const { authUrl, handshake } = await calls.start();
  if (!handshake) throw new Error("This server didn't start an app sign-in. Update Tinkerbell and try again.");

  let polls = 0;
  let closedAt: number | null = null;
  const listener = await Browser.addListener("browserFinished", () => {
    closedAt ??= polls;
  });

  try {
    await Browser.open({ url: authUrl, presentationStyle: "popover" });
    while (polls < MAX_POLLS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      polls++;
      const res = await calls.poll(handshake);
      if (res.status === "ok" && res.token) return { token: res.token, username: res.username };
      if (res.status === "expired") throw new Error("The sign-in expired. Try again.");
      if (closedAt !== null && polls - closedAt >= POLLS_AFTER_CLOSE) throw new SignInCancelled();
    }
    throw new Error("The sign-in expired. Try again.");
  } finally {
    await listener.remove();
    // Closing an already-closed sheet throws on Android; nothing to do about it.
    await Browser.close().catch(() => {});
  }
}
