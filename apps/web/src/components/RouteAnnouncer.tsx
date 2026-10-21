import { useEffect, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { titleForPath } from "#hooks/useDocumentTitle";

/* ─── Telling a screen reader the page changed ───────────────────────────────
 *
 * A client-side route change is invisible to assistive tech. Nothing reloads,
 * focus doesn't move, and `document.title` — which is what a full page load
 * would have announced — is not watched by any screen reader. Every navigation
 * in this app was therefore silent: the content under the cursor changed and
 * nothing said so.
 *
 * Two parts, deliberately:
 *
 *   <RouteAnnouncer/>  the live region, mounted once for the app's lifetime.
 *                      A region that mounts at the same moment as its text is
 *                      frequently missed — the announcement is the *change*,
 *                      so something has to have been there to change.
 *
 *   <RouteReady/>      renders inside the route's Suspense boundary, so it
 *                      mounts only once the lazy chunk has resolved and the
 *                      page is actually there. Announcing on `pathname` alone
 *                      would say "Collections" while a skeleton is still on
 *                      screen.
 *
 * The store between them is module-level rather than a context: the region
 * renders above the router's Suspense boundary and the signal comes from
 * inside it, so a provider would have to wrap both and would exist only to
 * carry one string.
 */

const listeners = new Set<() => void>();
let message = "";

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce(text: string): void {
  if (text === message) return;
  message = text;
  for (const fn of listeners) fn();
}

/** The live region itself. Mount once, high in the tree. */
export default function RouteAnnouncer() {
  const text = useSyncExternalStore(
    subscribe,
    () => message,
    () => "",
  );

  return (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {text}
    </p>
  );
}

/** Mount inside the route Suspense boundary. Renders nothing. */
export function RouteReady() {
  const { pathname } = useLocation();

  useEffect(() => {
    announce(`${titleForPath(pathname) ?? "Rube"} — loaded`);
  }, [pathname]);

  return null;
}
