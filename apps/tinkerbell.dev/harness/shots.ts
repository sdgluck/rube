/**
 * Every screenshot the suite captures.
 *
 * Names are `NN-page[-variant]`, numbered in sidebar order so the folder reads
 * as a tour of the app rather than an alphabetical jumble. `description` lands
 * in the manifest so a reviewer looking at a PNG knows which state it is.
 *
 * Most interesting states aren't URL-addressable, so a shot can reach one by:
 *   - query params, where the page reads them (Media's filter drawer, sorting)
 *   - a search term that matches nothing, for filtered-empty states
 *   - `storage`, for the view toggles that live in localStorage
 *   - `steps`, for anything behind a click or a keystroke
 *   - `failRoutes`, to make one API call fail so the error state renders
 */

export type Viewport = "desktop" | "mobile";

export type Step =
  /** Click a button by its accessible name. */
  | { click: string }
  /** Click the first element containing this text — for links and tabs. */
  | { clickText: string }
  /** Click by CSS selector, where nothing carries a usable accessible name. */
  | { clickSelector: string }
  /** Type into the input with this placeholder. */
  | { fill: string; text: string }
  /** Press a key or chord, e.g. "Meta+k", "Escape", "?". */
  | { press: string }
  /** Wait for a selector to appear. */
  | { wait: string }
  /** Type into the focused element. */
  | { type: string };

export interface Shot {
  name: string;
  description: string;
  path: string;
  /** Defaults to both. */
  viewports?: Viewport[];
  /** localStorage written before the first paint. */
  storage?: Record<string, string>;
  /** Substrings of tRPC URLs to fail, so an error state renders. */
  failRoutes?: string[];
  steps?: Step[];
  /** Selector that must appear before the shot is taken. */
  waitFor?: string;
  settleMs?: number;
  /**
   * Pages whose spinner never resolves (a probe against a service the mock
   * doesn't implement) opt out of the "no spinners left" wait.
   */
  allowSpinner?: boolean;
  /** Also written to the marketing site's folder under this slug, at 2x. */
  site?: string;
}

const DESKTOP: Viewport[] = ["desktop"];
const MOBILE: Viewport[] = ["mobile"];

export const SHOTS: Shot[] = [
  // ── Dashboard ────────────────────────────────────────────────────────────
  {
    name: "01-stats",
    description: "Stats dashboard — metric tiles over the two-column panel masonry",
    path: "/stats",
    site: "stats",
    settleMs: 700,
  },
  {
    name: "01-stats-tile-picker",
    description: "Stats — the tile picker popover open, showing the tile registry",
    path: "/stats",
    viewports: DESKTOP,
    steps: [{ click: "Customize tiles" }, { wait: "text=Choose up to" }],
  },
  {
    name: "02-preview",
    description: "Preview — the Plex home screen as a chosen user, on the dark stage",
    path: "/preview",
    site: "preview",
    settleMs: 900,
  },

  // ── Library ──────────────────────────────────────────────────────────────
  {
    name: "03-collections-table",
    description: "Collections — the shared list skeleton in table view",
    path: "/collections",
    storage: { "collections-view": "table" },
  },
  {
    name: "03-collections-grid",
    description: "Collections — poster grid view",
    path: "/collections",
    storage: { "collections-view": "grid" },
    site: "collections",
    settleMs: 700,
  },
  {
    name: "03-collections-empty",
    description: "Collections — the filtered-empty state, when a search matches nothing",
    path: "/collections?q=zzzznothingmatches",
  },
  {
    name: "03-collections-error",
    description: "Collections — the error state, when the list request fails",
    path: "/collections",
    failRoutes: ["collections.list"],
  },
  {
    name: "03-collections-bulk",
    description: "Collections — rows selected, showing the inverse bulk-action bar",
    path: "/collections",
    storage: { "collections-view": "table" },
    viewports: DESKTOP,
    steps: [{ clickSelector: "thead input[type='checkbox']" }],
  },
  {
    name: "04-collection-detail",
    description: "Collection detail — header, labels and the item grid",
    path: "/collections/5001",
    settleMs: 700,
  },
  {
    name: "04-collection-smart-filters",
    description: "Collection detail — the Smart Filters drawer with the nesting grammar",
    path: "/collections/5001",
    viewports: DESKTOP,
    steps: [{ click: "Edit filters" }, { wait: "text=of the following" }],
  },
  {
    name: "05-media-table",
    description: "Media — table view with the default four columns",
    path: "/media",
    storage: { "media-view": "table" },
    site: "media",
  },
  {
    name: "05-media-grid",
    description: "Media — poster grid view",
    path: "/media",
    storage: { "media-view": "grid" },
    settleMs: 700,
  },
  {
    name: "05-media-filters",
    description: "Media — the advanced filter drawer, opened by its URL params",
    path: "/media?res=4k&vcodec=hevc",
    storage: { "media-view": "table" },
  },
  {
    name: "05-media-columns",
    description: "Media — the column configurator dropdown",
    path: "/media",
    storage: { "media-view": "table" },
    viewports: DESKTOP,
    steps: [{ click: "Columns" }],
  },
  {
    name: "06-media-detail",
    description: "Media detail — poster, metadata chips and stream breakdown",
    path: "/media/1000",
    settleMs: 700,
  },
  {
    name: "07-overlays",
    description: "Overlays — the three-column workspace: catalogue, poster canvas, inspector",
    path: "/overlays",
    site: "overlays",
    settleMs: 1200,
  },
  {
    name: "08-prerolls",
    description: "Prerolls — upload dropzone, preroll cards and the Plex sync bar",
    path: "/prerolls",
    settleMs: 700,
  },

  // ── Automation ───────────────────────────────────────────────────────────
  {
    name: "09-rules",
    description: "Rules — the dense list with type pills, toggles and per-row actions",
    path: "/rules",
    site: "rules",
  },
  {
    name: "09-rules-empty",
    description: "Rules — the filtered-empty state",
    path: "/rules",
    steps: [{ fill: "Search rules…", text: "zzzznothingmatches" }],
  },
  {
    name: "09-cleanup-queue",
    description: "Cleanup — what the rules have matched, with the streak each item is on",
    path: "/cleanup",
  },
  {
    name: "09-cleanup-rules",
    description: "Cleanup — the rules themselves, on their own tab beside the queue",
    path: "/cleanup/rules",
    steps: [{ wait: "text=Queue" }],
  },
  {
    name: "10-rule-wizard-1-type",
    description: "Rule wizard step 1 — the 28 rule types as selectable cards",
    path: "/rules",
    viewports: DESKTOP,
    steps: [{ click: "Add Rule" }, { wait: "text=Choose a rule type" }],
  },
  {
    name: "10-rule-wizard-2-source",
    description: "Rule wizard step 2 — source configuration for a Smart Filter rule",
    path: "/rules",
    viewports: DESKTOP,
    // By description, not by name: the type filter chips on the page behind the
    // modal are labelled "Smart Filter" too, and they come first in the DOM.
    steps: [
      { click: "Add Rule" },
      { clickText: "Build a single collection by AND'ing Plex filter clauses" },
      { click: "Next" },
      // Not the AND/OR row: that only renders once a group has more than one
      // clause, and a new rule starts with one.
      { wait: "text=+ Add clause" },
    ],
  },
  {
    // A Smart Filter rule can't leave its source step until it has a clause, so
    // the scope step is reached through a type that has no source step at all.
    // The card is picked by its description because "Studios" also names a
    // filter chip on the page behind the modal.
    name: "10-rule-wizard-3-scope",
    description: "Rule wizard step 3 — library sections and scope",
    path: "/rules",
    viewports: DESKTOP,
    // Two Nexts, not one: Outcome sits between Type and Scope, because what a
    // rule does decides what Scope asks it (a cleanup rule is never pinned).
    steps: [
      { click: "Add Rule" },
      { clickText: "Build a collection per production company" },
      { click: "Next" },
      { click: "Next" },
      { wait: "text=Sections" },
    ],
  },
  {
    // The step that decides what a rule's collections look like in Plex.
    // Reached through Top Rated rather than Studios: a grouped rule can't
    // leave Scope until it has answered the pin-rotation question, and this
    // shot is about the step after it. The poster is a real render, so the
    // shot also proves the preview round-trip works.
    name: "10-rule-wizard-4-look",
    description: "Rule wizard step 4 — description and poster, with a live render of the poster",
    path: "/rules",
    viewports: DESKTOP,
    steps: [
      { click: "Add Rule" },
      { clickText: "Group your highest-rated items in the library" },
      { click: "Next" },
      { click: "Next" },
      { click: "Next" },
      { wait: "text=How should these collections look?" },
      { clickText: "Generate a poster for these collections" },
      { wait: "img[alt^='Poster preview']" },
    ],
  },
  {
    name: "11-jobs",
    description: "Jobs — metric tiles over the Core and Features panels",
    path: "/jobs",
    site: "jobs",
    settleMs: 700,
  },
  {
    name: "12-job-detail",
    description: "Job detail — Generate Collections, with run history and configuration",
    path: "/jobs/generate",
    settleMs: 700,
  },
  {
    name: "13-job-run",
    description: "Run log — run stats over the dark log viewer",
    path: "/jobs/runs/run-generate-1",
    settleMs: 700,
  },

  // ── Admin ────────────────────────────────────────────────────────────────
  {
    name: "14-users",
    description: "Users — shared users with their personalization status",
    path: "/users",
  },
  {
    name: "15-events",
    description: "Events — the activity feed with collapsed repeats",
    path: "/events",
    site: "events",
  },
  {
    name: "15-events-empty",
    description: "Events — the filtered-empty state",
    path: "/events?q=zzzznothingmatches",
  },

  // ── Settings ─────────────────────────────────────────────────────────────
  {
    name: "16-settings-plex",
    description: "Settings → Plex — connection form and managed libraries",
    path: "/settings/plex",
  },
  {
    name: "16-settings-ai",
    description: "Settings → AI — key, model and the monthly token ceiling",
    path: "/settings/ai",
  },
  {
    name: "16-settings-arrs",
    description: "Settings → Media Managers — Radarr, with the raised sub-nav",
    path: "/settings/arrs/radarr",
  },
  {
    name: "16-settings-databases",
    description: "Settings → Databases — OMDb",
    path: "/settings/databases/omdb",
  },
  {
    name: "16-settings-notifications",
    description: "Settings → Notifications — Discord, with configured channels dotted",
    path: "/settings/notifications/discord",
  },
  {
    name: "16-settings-schedules",
    description: "Settings → Schedules — the timezone job schedules are evaluated in",
    path: "/settings/schedules",
  },
  {
    name: "16-settings-portal-personalization",
    description: "Settings → Portal → Personalization — status card and what turning it on or off does",
    path: "/settings/portal/personalization",
  },
  {
    name: "16-settings-portal-appearance",
    description: "Settings → Portal → Appearance — icon picker, colours and the live preview",
    path: "/settings/portal/appearance",
  },
  {
    name: "16-settings-posters",
    description: "Settings → Posters — poster cache configuration and preview",
    path: "/settings/posters",
  },
  {
    name: "16-settings-appearance",
    description: "Settings → Appearance — collection artwork defaults, with a live render of the template",
    path: "/settings/appearance",
  },
  {
    name: "16-settings-prerolls",
    description: "Settings → Prerolls — the path mapping Plex sees",
    path: "/settings/prerolls",
  },
  {
    name: "16-settings-health",
    description: "Settings → Health — per-integration status and 24h sparklines",
    path: "/settings/health",
    allowSpinner: true,
  },
  {
    name: "16-settings-bandwidth",
    description: "Settings → Bandwidth Test — last result, and 90 days of upload figures",
    path: "/settings/bandwidth",
  },
  {
    name: "16-settings-maintenance",
    description: "Settings → Maintenance — five tool rows, the destructive two outlined",
    path: "/settings/maintenance",
  },
  {
    name: "16-settings-migrate",
    description: "Settings → Migrate — provider panels and the last-import report",
    path: "/settings/migrate",
  },
  {
    name: "16-settings-stress-test",
    description: "Settings → Stress Test — the dev-only load harness",
    path: "/settings/stress-test",
  },
  {
    name: "16-settings-credits",
    description: "Settings → Credits",
    path: "/settings/credits",
  },
  // ── Everything else ──────────────────────────────────────────────────────
  {
    name: "17-changelog",
    description: "Changelog — one card per release with added/changed/fixed tags",
    path: "/settings/changelog",
  },
  {
    name: "18-command-palette",
    description: "Command palette — grouped results with the first pre-armed",
    path: "/stats",
    steps: [{ press: "Meta+k" }, { wait: "[role=listbox]" }],
  },
  {
    name: "18-shortcuts",
    description: "Keyboard shortcuts panel",
    path: "/stats",
    steps: [{ press: "?" }, { wait: "text=Navigation" }],
  },
  {
    name: "19-mobile-more",
    description: "Mobile — the More page listing every destination the bottom nav doesn't hold",
    path: "/more",
    viewports: MOBILE,
  },
];
