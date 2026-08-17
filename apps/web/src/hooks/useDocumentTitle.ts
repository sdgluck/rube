import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { trpc } from "#/trpc";
import { NAV_SECTIONS } from "#/nav";
import { SETTINGS_SECTIONS } from "#pages/Settings/sections";

/**
 * Longest-prefix route → title. Built from the same nav definitions the
 * sidebar and settings rail render, so a new page gets a title for free.
 */
const ROUTE_TITLES: [prefix: string, title: string][] = [
  ...SETTINGS_SECTIONS.flatMap((s) => s.links.map((l) => [l.to, `Settings: ${l.label}`] as [string, string])),
  ...NAV_SECTIONS.flatMap((s) => s.items.map((i) => [i.to, i.label] as [string, string])),
  ["/settings/changelog", "Changelog"],
  ["/cleanup/rules", "Cleanup rules"],
  ["/more", "More"],
];

/** Also used by the route announcer, so both say the same thing. */
export function titleForPath(pathname: string): string | null {
  let best: string | null = null;
  let bestLen = 0;
  for (const [prefix, title] of ROUTE_TITLES) {
    if ((pathname === prefix || pathname.startsWith(`${prefix}/`)) && prefix.length > bestLen) {
      best = title;
      bestLen = prefix.length;
    }
  }
  return best;
}

export default function useDocumentTitle() {
  const { pathname } = useLocation();
  const sessionsQuery = trpc.stats.sessions.useQuery(undefined, {
    refetchInterval: 10000,
    refetchOnWindowFocus: false,
  });

  const count = sessionsQuery.data?.length || 0;

  useEffect(() => {
    const page = titleForPath(pathname);
    // Active-stream count leads so it stays readable in a narrow tab.
    const prefix = count > 0 ? `(${count}) ` : "";
    document.title = page ? `${prefix}${page} · Tinkerbell` : `${prefix}Tinkerbell`;
  }, [count, pathname]);
}
