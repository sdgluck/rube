/**
 * The breadcrumb trail, split out of `nav.ts` so that module has no imports.
 *
 * Only this half needs `SETTINGS_LINKS`, and that subpath import is what made
 * the nav module unloadable under `node --test` — the resolvers next door carry
 * the whole forward-compatibility story for a saved menu layout and have to be
 * testable without a bundler to resolve `#pages/*`.
 */
import { SETTINGS_LINKS } from "#pages/Settings/sections";
import { NAV_SECTIONS } from "#/nav";

export type Crumb = { label: string; to: string };

/**
 * The route's place in the nav, as a breadcrumb trail — the app bar's answer
 * to "where am I" now that pages don't render a title of their own.
 *
 * Drill-in routes (/jobs/:id, /media/:key) stop at their section, because the
 * record's name isn't in the URL — the page appends it with <PageCrumbs>, which
 * is also what turns the section above it back into a link. Settings is the
 * exception that can be resolved from the path alone.
 *
 * Reads the catalogue, not the resolved menu, and takes no prefs: a page hidden
 * from the sidebar is still a page you can be standing on, and it still has to
 * say where you are.
 */
export function routeTrail(pathname: string): Crumb[] {
  // Rail links that leave /settings (Setup) belong to whatever section they
  // actually live in, not under a Settings crumb.
  const settings = SETTINGS_LINKS.find(
    (l) => l.to.startsWith("/settings/") && (pathname === l.to || pathname.startsWith(`${l.to}/`)),
  );
  if (settings)
    return [
      { label: "Settings", to: "/settings" },
      { label: settings.label, to: settings.to },
    ];

  // A record page lives under the library it belongs to, not under Instances.
  // `/arrs/:instanceId/movies/:arrId` shares the `/arrs` prefix with the
  // instance list, but "Instances / The Matrix" describes nothing — the trail
  // a person wants back is the list they came from.
  const record = /^\/arrs\/[^/]+\/(movies|series)\/[^/]+$/.exec(pathname);
  if (record) {
    return record[1] === "movies" ? [{ label: "Movies", to: "/movies" }] : [{ label: "TV", to: "/tv" }];
  }

  const extras: Crumb[] = [
    { label: "Changelog", to: "/settings/changelog" },
    { label: "More", to: "/more" },
    { label: "Registry", to: "/registry" },
  ];
  const items: Crumb[] = [
    ...NAV_SECTIONS.flatMap((s) => s.items.map((i) => ({ label: i.label, to: i.to }))),
    ...extras,
  ];

  let best: Crumb | null = null;
  for (const item of items) {
    if ((pathname === item.to || pathname.startsWith(`${item.to}/`)) && item.to.length > (best?.to.length ?? 0)) {
      best = item;
    }
  }
  return best ? [best] : [];
}
