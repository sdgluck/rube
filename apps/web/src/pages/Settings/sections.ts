/**
 * The settings rail, as data. Shared by the rail itself, the command palette
 * and the document-title hook so a new settings page is reachable and
 * titled without touching three files.
 */
export type SettingsLink = { to: string; label: string };
export type SettingsSection = { heading: string; links: SettingsLink[] };

// Seven short headings rather than four long ones: "Automation" and "Tools"
// had grown to nine and eleven pages, and a heading that long stops telling
// you where to look. Each heading now answers one question — what is
// connected, what happens to the library, how it looks, what users see, who
// can reach the instance, how to get data back, and whether the box copes.
export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    heading: "Connections",
    links: [
      // The setup flow's permanent home. It leaves the sidebar once every step
      // is done (see `hideWhenSetupComplete` in nav.ts) but never stops being
      // worth reopening — it is the one screen that says what is and isn't
      // connected, and steps skipped early are picked up here later.
      { to: "/onboarding", label: "Setup" },
      { to: "/settings/plex", label: "Plex" },
      { to: "/settings/ai", label: "AI" },
      { to: "/settings/arrs", label: "Media Managers" },
      { to: "/settings/databases", label: "Databases" },
      { to: "/settings/home-assistant", label: "Home Assistant" },
    ],
  },
  {
    heading: "Library",
    links: [
      { to: "/settings/cleanup", label: "Cleanup" },
      { to: "/settings/watchlist", label: "Watchlist" },
      { to: "/settings/metadata", label: "Metadata" },
    ],
  },
  {
    heading: "Presentation",
    links: [
      { to: "/settings/appearance", label: "Appearance" },
      { to: "/settings/posters", label: "Posters" },
      { to: "/settings/prerolls", label: "Prerolls" },
    ],
  },
  {
    heading: "Users",
    links: [
      { to: "/settings/portal", label: "Portal" },
      { to: "/settings/notifications", label: "Notifications" },
      { to: "/settings/digest", label: "Digest" },
    ],
  },
  {
    heading: "Access",
    links: [
      { to: "/settings/security", label: "Security" },
      // Beside Security: both are about who can reach this instance, and an API
      // key is the other credential it accepts.
      { to: "/settings/api", label: "API & MCP" },
      { to: "/settings/mobile", label: "Mobile app" },
    ],
  },
  {
    heading: "Data",
    links: [
      // Together on purpose: the two answers to "something is wrong and I want
      // it back" are the change history and a backup, and somebody in that
      // state should not have to know which one they need before they look.
      { to: "/settings/backup", label: "Backup & Restore" },
      { to: "/settings/history", label: "Change History" },
      { to: "/settings/migrate", label: "Migrate" },
      { to: "/settings/maintenance", label: "Maintenance" },
    ],
  },
  {
    heading: "Diagnostics",
    links: [
      { to: "/settings/health", label: "Health" },
      // Both answer "is this server actually up to it?", one for the link and
      // one for the transcoder.
      { to: "/settings/bandwidth", label: "Bandwidth Test" },
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
