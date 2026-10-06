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
      { to: "/settings/cleanup", label: "Cleanup" },
      { to: "/settings/watchlist", label: "Watchlist" },
      { to: "/settings/metadata", label: "Metadata" },
      { to: "/settings/portal", label: "Portal" },
      { to: "/settings/notifications", label: "Notifications" },
      { to: "/settings/digest", label: "Digest" },
      { to: "/settings/posters", label: "Posters" },
      { to: "/settings/appearance", label: "Appearance" },
      { to: "/settings/prerolls", label: "Prerolls" },
    ],
  },
  {
    heading: "Tools",
    links: [
      // The setup flow's permanent home. It leaves the sidebar once every step
      // is done (see `hideWhenSetupComplete` in nav.ts) but never stops being
      // worth reopening — it is the one screen that says what is and isn't
      // connected, and steps skipped early are picked up here later.
      { to: "/onboarding", label: "Setup" },
      { to: "/settings/security", label: "Security" },
      // Beside Security: both are about who can reach this instance, and an API
      // key is the other credential it accepts.
      { to: "/settings/api", label: "API & MCP" },
      { to: "/settings/migrate", label: "Migrate" },
      { to: "/settings/maintenance", label: "Maintenance" },
      // Adjacent on purpose: the two answers to "something is wrong and I want
      // it back" are the change history and a backup, and somebody in that
      // state should not have to know which one they need before they look.
      { to: "/settings/backup", label: "Backup & Restore" },
      { to: "/settings/history", label: "Change History" },
      { to: "/settings/bandwidth", label: "Bandwidth Test" },
      { to: "/settings/health", label: "Health" },
      // Next to the bandwidth test on purpose: both answer "is this server
      // actually up to it?", one for the link and one for the transcoder.
      { to: "/settings/stress-test", label: "Stress Test" },
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
