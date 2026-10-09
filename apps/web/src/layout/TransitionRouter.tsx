import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Router, UNSAFE_createBrowserHistory as createBrowserHistory, type Location } from "react-router-dom";
import { runTransition, takeNavigationHint, transitionFor, transitionsEnabled } from "@tinkerbell/native-client";

type HistoryState = { action: "PUSH" | "POP" | "REPLACE"; location: Location };

/**
 * `BrowserRouter`, plus native page transitions on phones.
 *
 * React Router only drives View Transitions from its data router, and this app
 * is on the declarative one, so this is `BrowserRouter`'s own ~20 lines with
 * one change: when `transitionFor` says a navigation should animate, the state
 * update runs inside `runTransition` under `flushSync`, so the browser
 * captures the old screen, React renders the new one synchronously, and the
 * two animate between. Every other update is the same `startTransition` the
 * stock router uses.
 */
export default function TransitionRouter({ children }: { children: ReactNode }) {
  const historyRef = useRef<ReturnType<typeof createBrowserHistory>>(null);
  historyRef.current ??= createBrowserHistory({ v5Compat: true });
  const history = historyRef.current;
  const [state, setState] = useState<HistoryState>({ action: history.action, location: history.location });
  const current = useRef(state);
  current.current = state;

  useLayoutEffect(
    () =>
      history.listen(({ action, location }) => {
        const next = { action, location } as HistoryState;
        const direction = transitionFor({
          action,
          fromPath: current.current.location.pathname,
          toPath: location.pathname,
          hint: takeNavigationHint(),
          enabled: transitionsEnabled(),
        });
        if (direction) runTransition(direction, () => flushSync(() => setState(next)));
        else setState(next);
      }),
    [history],
  );

  return (
    <Router location={state.location} navigationType={state.action as never} navigator={history}>
      {children}
    </Router>
  );
}
