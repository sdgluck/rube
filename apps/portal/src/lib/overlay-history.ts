/**
 * Back closes the sheet, not the page behind it.
 *
 * On a phone, a sheet, an action sheet or the search palette is a screen the
 * user went "into", and Back — Android's back button or gesture, the iOS edge
 * swipe, a mobile browser's back — is how they expect to leave it. Overlays
 * never touched history, so Back navigated the page underneath while the
 * modal stayed open over it.
 *
 * So opening an overlay pushes a history entry (same URL), and popping that
 * entry closes it. Closing it any other way (the ✕, a backdrop tap, saving)
 * pops the entry itself so it doesn't linger as a dead step in history. Only
 * on phones and touch devices: on a desktop, Back has always meant "previous
 * page", and a dialog that ate the first press would be a regression.
 *
 * Framework-free so the portal's sheets can wrap it in their own effect. It
 * came from the retired `packages/native-client` when the admin app dropped its
 * phone emulation; the portal's phone polish is reworked separately.
 */

const STATE_KEY = "tbOverlayDepth";
const PHONE = "(max-width: 768px), (pointer: coarse)";

type Entry = { close: () => void; depth: number };
const stack: Entry[] = [];
let listening = false;
/** Set while we pop our own entry, so the popstate it causes isn't treated as "Back". */
let selfPop = 0;

function depthOf(state: unknown): number {
  const d = (state as Record<string, unknown> | null)?.[STATE_KEY];
  return typeof d === "number" ? d : 0;
}

function onPopState(event: PopStateEvent): void {
  if (selfPop > 0) {
    selfPop--;
    return;
  }
  const depth = depthOf(event.state);
  // Close every overlay above the depth we landed on — usually one.
  while (stack.length && stack[stack.length - 1].depth > depth) stack.pop()!.close();
}

/**
 * Register an open overlay. Returns `release`, to call when it closes by any
 * other means. On a desktop it registers nothing and `release` does nothing.
 */
export function pushOverlay(close: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia(PHONE).matches) return () => {};
  if (!listening) {
    window.addEventListener("popstate", onPopState);
    listening = true;
  }
  const entry: Entry = { close, depth: stack.length + 1 };
  stack.push(entry);
  // The router's own state is kept: its location key and index have to
  // survive the extra entry, or it sees the pop as a navigation.
  history.pushState({ ...history.state, [STATE_KEY]: entry.depth }, "");

  return () => {
    const i = stack.indexOf(entry);
    if (i === -1) return; // already closed by Back
    stack.splice(i, 1);
    // Still the current entry: step back over it. If the overlay navigated
    // somewhere (a link inside a sheet), that entry is gone already.
    if (depthOf(history.state) === entry.depth) {
      selfPop++;
      history.back();
    }
  };
}
