import { useEffect, useState } from "react";

/**
 * Live `matchMedia` result, for the handful of places a breakpoint has to
 * change *structure* rather than style — CSS can restyle a two-column layout
 * at a breakpoint, but it can't re-parent the panels inside it.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** The phone layout's breakpoint — `--bp-md` in App.css, where the sidebar becomes a drawer. */
export const PHONE_QUERY = "(max-width: 768px)";

/** True in the phone layout: the sidebar is a drawer and the document scrolls. */
export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
