/**
 * Movie match's place in the portal's URL, and a guest's room tokens.
 *
 * The portal routes on the hash (`#collections`, `#preferences`, …), so a room
 * is `#match/CODE`, and an invite link is `#match/CODE/SECRET`. The secret
 * rides in the fragment because a fragment never reaches a server or a proxy
 * log on the way here.
 *
 * A guest has no session, only a token per room, kept on this device. The
 * portal's tRPC client sends the current one as `X-Match-Guest` — and only
 * when nobody is signed in, since a session wins on the server anyway.
 */
import { MATCH_CODE_ALPHABET, MATCH_CODE_LENGTH } from "@tinkerbell/contracts";

export interface MatchRoute {
  code: string | null;
  invite: string | null;
}

const CODE = new RegExp(`^[${MATCH_CODE_ALPHABET}]{${MATCH_CODE_LENGTH}}$`);

export function parseMatchHash(hash: string = location.hash): MatchRoute | null {
  const [tab, code, invite] = hash.replace(/^#/, "").split("/");
  if (tab !== "match") return null;
  const upper = code?.toUpperCase() ?? "";
  return { code: CODE.test(upper) ? upper : null, invite: CODE.test(upper) && invite ? invite : null };
}

export function matchHash(code?: string | null): string {
  return code ? `#match/${code}` : "#match";
}

/**
 * Signing in leaves for plex.tv and comes back to the portal's root, so an
 * invite link opened by someone who then chooses "Sign in with Plex" would
 * otherwise lose the room it was for.
 */
const PENDING_LINK_KEY = "tb_match_pending_link";

export function rememberLinkAcrossSignIn(): void {
  try {
    if (parseMatchHash()?.code) localStorage.setItem(PENDING_LINK_KEY, location.hash);
  } catch {
    /* storage unavailable: the link is lost, the sign-in isn't */
  }
}

export function takePendingLink(): string | null {
  try {
    const hash = localStorage.getItem(PENDING_LINK_KEY);
    localStorage.removeItem(PENDING_LINK_KEY);
    return hash;
  } catch {
    return null;
  }
}

const GUEST_KEY = (code: string) => `tb_match_guest:${code}`;

export function guestToken(code: string): string | null {
  try {
    return localStorage.getItem(GUEST_KEY(code));
  } catch {
    return null;
  }
}

export function saveGuestToken(code: string, token: string | null): void {
  try {
    if (token) localStorage.setItem(GUEST_KEY(code), token);
    else localStorage.removeItem(GUEST_KEY(code));
  } catch {
    /* a guest who can't store their token rejoins next visit */
  }
}

let activeGuest: string | null = null;

/** Which room's guest token the next request carries; null for a signed-in user. */
export function setActiveGuest(token: string | null): void {
  activeGuest = token;
}

export function activeGuestToken(): string | null {
  return activeGuest;
}
