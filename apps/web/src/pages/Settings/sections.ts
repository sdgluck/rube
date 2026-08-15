/**
 * The settings rail, as data. Shared by the rail itself, the command palette
 * and the document-title hook so a new settings page is reachable and
 * titled without touching three files.
 */
export type SettingsLink = { to: string; label: string };
export type SettingsSection = { heading: string; links: SettingsLink[] };

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    heading: "Integrations",
    links: [
      { to: "/settings/plex", label: "Plex" },
      { to: "/settings/ai", label: "AI" },
      { to: "/settings/arrs", label: "Media Managers" },
      { to: "/settings/databases", label: "Databases" },
    ],
  },
  {
    heading: "Automation",
    links: [
      { to: "/settings/schedules", label: "Schedules" },
      { to: "/settings/cleanup", label: "Cleanup" },
      { to: "/settings/portal", label: "Portal" },
      { to: "/settings/notifications", label: "Notifications" },
      { to: "/settings/digest", label: "Digest" },
      { to: "/settings/posters", label: "Posters" },
      { to: "/settings/prerolls", label: "Prerolls" },
    ],
  },
  {
    heading: "Tools",
    links: [
      { to: "/settings/security", label: "Security" },
      { to: "/settings/migrate", label: "Migrate" },
      { to: "/settings/maintenance", label: "Maintenance" },
      { to: "/settings/bandwidth", label: "Bandwidth Test" },
      { to: "/settings/health", label: "Health" },
      // Load-testing tool: useful while developing, noise (and a footgun)
      // for someone running a release build against their real server.
      ...(import.meta.env.DEV ? [{ to: "/settings/stress-test", label: "Stress Test" }] : []),
    ],
  },
  {
    heading: "About",
    links: [
      { to: "/settings/changelog", label: "Changelog" },
      { to: "/settings/credits", label: "Credits" },
    ],
  },
];

/** Every settings link, flattened — for search and title lookup. */
export const SETTINGS_LINKS: SettingsLink[] = SETTINGS_SECTIONS.flatMap((s) => s.links);
