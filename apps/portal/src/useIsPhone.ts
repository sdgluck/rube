import { useEffect, useState } from "react";

/**
 * True in the phone layout — the same 768px switch the admin app uses. The
 * portal has no import path to the app's hooks, so it keeps its own.
 */
export function useIsPhone(): boolean {
  const query = "(max-width: 768px)";
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return matches;
}
