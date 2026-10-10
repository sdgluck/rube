import { useEffect, useState } from "react";
import { matchHash, parseMatchHash, type MatchRoute } from "./link.ts";

const CHANGED = "tb-match-route";

/** The room in the address bar, kept current across Back, links and `goToRoom`. */
export function useMatchRoute(): MatchRoute | null {
  const [route, setRoute] = useState(() => parseMatchHash());
  useEffect(() => {
    const sync = () => setRoute(parseMatchHash());
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    window.addEventListener(CHANGED, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
      window.removeEventListener(CHANGED, sync);
    };
  }, []);
  return route;
}

/** Into a room, as a history entry, so Back comes out of it. */
export function goToRoom(code: string): void {
  history.pushState({ ...history.state, matchRoom: true }, "", matchHash(code));
  window.dispatchEvent(new Event(CHANGED));
}

/** Back to the lobby: Back itself when we pushed the room, a replace when the room was a link. */
export function goToLobby(): void {
  if (history.state?.matchRoom) {
    history.back();
    return;
  }
  history.replaceState(history.state, "", matchHash());
  window.dispatchEvent(new Event(CHANGED));
}

/** Drop an invite secret from the address bar once it has been used. */
export function settleOnRoom(code: string): void {
  history.replaceState(history.state, "", matchHash(code));
  window.dispatchEvent(new Event(CHANGED));
}
