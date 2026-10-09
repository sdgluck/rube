/**
 * Native-style page transitions on phones: a push slides the new screen in
 * (iOS) or fades through (Material), and the header's back button plays it in
 * reverse.
 *
 * The decision lives here and the router calls it (`apps/web`'s
 * `TransitionRouter`): it wraps its own state update in `runTransition`, which
 * starts a View Transition and renders the new route *inside* it, so the old
 * screen is captured before React changes a pixel. Hooking `pushState`
 * instead was tried and is a race: the router renders from the arguments it
 * passed, not from `location`, so the screen could change before the capture.
 *
 * Deliberately not animated (`transitionFor` returns null):
 * - a change of search params only — filters and in-page tabs, same screen;
 * - a switch between bottom tabs — native tab bars switch instantly;
 * - a pop that didn't come from our own back button — iOS's edge swipe and a
 *   browser's back already animate with their own snapshot, and a second
 *   animation on top would play the page twice;
 * - anything under `prefers-reduced-motion`, off the phone layout, or without
 *   the View Transitions API.
 *
 * Pure apart from the DOM-touching runner, so the decision is unit-tested.
 */

export type NavDirection = "push" | "pop";

let pendingKind: "tab" | "back" | null = null;

/** The next navigation is a bottom-tab switch, which doesn't animate. */
export function markTabNavigation(): void {
  pendingKind = "tab";
}

/** Take (and clear) the hint left by `markTabNavigation` / `navigateBack`. */
export function takeNavigationHint(): "tab" | "back" | null {
  const kind = pendingKind;
  pendingKind = null;
  return kind;
}

export function transitionFor(input: {
  action: "PUSH" | "POP" | "REPLACE";
  fromPath: string;
  toPath: string;
  hint: "tab" | "back" | null;
  enabled: boolean;
}): NavDirection | null {
  if (!input.enabled || input.hint === "tab" || input.fromPath === input.toPath) return null;
  if (input.action === "PUSH") return "push";
  if (input.action === "POP" && input.hint === "back") return "pop";
  return null;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/** Whether the phone layout can animate right now. */
export function transitionsEnabled(): boolean {
  if (typeof document === "undefined") return false;
  return (
    typeof (document as ViewTransitionDocument).startViewTransition === "function" &&
    window.matchMedia("(max-width: 768px)").matches &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Render `update` inside a View Transition, with the direction on `<html data-nav>`. */
export function runTransition(direction: NavDirection, update: () => void): void {
  const root = document.documentElement;
  root.dataset.nav = direction;
  const transition = (document as ViewTransitionDocument).startViewTransition!(update);
  void transition.finished.finally(() => {
    if (root.dataset.nav === direction) delete root.dataset.nav;
  });
}

/**
 * Go back with the pop animation — the header's back button, Android's back
 * key. With no in-app history to go back to (a deep link straight into a
 * detail page), `fallback` navigates to the parent screen instead.
 */
export function navigateBack(fallback?: () => void): void {
  // React Router keeps an index in history.state; the portal has no router,
  // so there the browser's own length is the only measure.
  const idx = (history.state as { idx?: unknown } | null)?.idx;
  const hasHistory = typeof idx === "number" ? idx > 0 : history.length > 1;
  if (hasHistory) {
    pendingKind = "back";
    history.back();
  } else {
    fallback?.();
  }
}
