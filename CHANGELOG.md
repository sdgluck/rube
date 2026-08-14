# Changelog

All notable changes to Tinkerbell are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Tinkerbell is currently beta software (0.x) — APIs, data shapes, and behaviour may change between releases.

## [Unreleased]

## [0.11.0] - 2026-08-14

### Changed

- **Jellyseerr/Overseerr is now labelled just "Seerr" throughout the UI** — the Media Managers tab title, the registry requirement label, the rule wizard's requirement hint and not-configured warning, and the requested-items rule type description all use the shorter name. No config keys or routes change, so no action is needed on upgrade.
- The Personalization pane now shows status as a coloured pill (Off / On / mid-job) with enabled-since and last-reconciled details next to it, instead of a plain status line.
- Turning personalization on or off now shows the actual numbered steps each job performs, in two cards ("Turning it on" / "Turning it off"), with the card matching the button you'd press highlighted and each ending with its real consequence: enabling doesn't remove anyone's access, and disabling leaves the server as if it was never on.
- Caveats about personalization — that the owner can't be restricted, that new shared users are picked up by Sync Plex Users, that both jobs are long-running but resumable, and that you should re-run after changing library selection — now live in a "Worth knowing" card instead of a footnote.
- The Reconcile users button in the Personalization pane now explains what it does.
- Personalization buttons and confirmations now read "Turn on" / "Turn off" to match the status pill.

## [0.10.0] - 2026-08-14

### Added

- Both smart-filter editors (runtime filters and the rule wizard) now show filters in plain English instead of Plex's raw wire format — for example, a duration filter reads "Duration is 2h" instead of `duration = 7200000`, and a date filter reads "in the last 30 days" instead of `-30d`.
- Boolean smart-filter fields (like "unwatched") now get a proper toggle control instead of falling back to a free-text box expecting `1`.
- The rule wizard now shows a tag lookup for tag-type fields instead of a bare text input, so values like genres display by name instead of as raw internal IDs.
- The rule wizard's review pane now shows readable field names and operators instead of raw field keys and operator symbols.
- TV-scoped smart filter fields (such as show genre or episode watched status) are now correctly typed and labelled instead of falling back to generic string handling.

### Fixed

- The rules table now correctly counts filters for smart-filter rules; it previously always showed no filters because it was reading an old data format the wizard no longer writes.
- Tag values (e.g. genres) shown in the rules table now resolve to their actual names via a single batched lookup instead of being left unresolved.

## [0.9.0] - 2026-08-14

### Added

- **/more page:** on mobile, the fourth "More" nav tab now opens `/more`, a regular page instead of a bottom sheet. It's deep-linkable, works with the back button, and supports scroll restoration.

### Changed

- On mobile, the More page's per-page metrics now load directly instead of only when the old sheet was open.

### Fixed

- **Mobile pages no longer scroll sideways.** Dashboard panels using the dense table style (Stats, Jobs lists, run history) were pushing the page up to 230px wider than the screen; they now scroll within their own panel instead. The rules bulk-action bar now wraps instead of overflowing, the rule preview row no longer bleeds off the right edge, the smart filter editor fits inside its drawer, the overlay catalog no longer forces three columns on narrow screens, and dropdown menus no longer grow off-screen behind long names.
- Fixed the mobile capture step that screenshots the More page, which was still trying to click the old bottom-sheet button and broke the release capture run.
- The auto-generated changelog for each release now summarizes the full reasoning from commit messages instead of just their one-line subjects, so entries are more specific about what changed and what (if anything) needs reconfiguring after upgrading.

### Removed

- Removed the mobile bottom-sheet "More" menu (replaced by the `/more` page above).

## [0.8.0] - 2026-08-14

### Added

- Public rule registry: browse curated rule packs from tinkerbell.dev and import them in-app, with a dry-run preview that reports filter values your server has no tag for, integrations you haven't configured, and rule names that would collide.
- Import options for packs: choose homepage pinning, how many collections rotate onto the home at a time, a cap on collections per rule, and a minimum items per collection — all before anything is written, and shown in the preview.
- Grouped rules (Directors, Studios, Genres, Decades, Resolutions, …) now expose their collection cap and minimum-items floor in the rule wizard, with a warning about how many collections an uncapped rule can build.
- The TMDb-sourced rules (Popular Actors, Popular Directors, Franchises) expose how many people or franchise groups they fetch per run, which previously wasn't reachable from the UI.

### Changed

- **Grouped rules now build a collection for every group by default.** Previously they silently kept only the largest 10–20 groups and skipped anything with fewer than 3 items, with no way to see or change either number. Existing rules have no saved cap, so their next run will build many more collections than before — open them in the wizard and set a cap or a minimum if you'd rather keep the old shape.
- Rules that can produce hundreds of collections now require a homepage rotation count when pinning is on, instead of pinning every collection they build. Rules saved before this rotate 10 per library.
- Registry packs ship their grouped rules pinned with 10 collections rotating, and uncapped — a pack author can't know how large your library is, so the long tail is left to you rather than dropped.
- Applying a pack update keeps your libraries, pinning, rotation size, collection cap and minimum-items setting. Updates refresh what a rule matches, never how you configured it to behave.

### Fixed

- Registry cache keys containing a NUL separator are now escaped, so two different rules can't collide on one cache entry.
- Collection cache rows are evicted when a job deletes the collection from Plex, instead of lingering as phantom entries.

## [0.7.2] - 2026-08-13

### Fixed

- TypeScript base configuration is now correctly copied into Docker images
- Overlapping runs no longer create duplicate collections

### Changed

- Improved type checking performance from 122s to 6s by upgrading to TypeScript 7

## [0.7.1] - 2026-08-13

### Fixed

- Fixed rules failing when a sibling deletes a collection mid-walk

## [0.7.0] - 2026-08-13

### Added

- Multi-select filters

### Changed

- Unified control heights across UI
- Removed page subheadings

### Fixed

- Fixed run log duplicating lines when polling overruns its tick

## [0.6.5] - 2026-08-13

### Added

- Expose generate rule concurrency configuration in the admin UI

### Changed

- Improved performance of rule generation through library walk memoization and concurrent rule execution

## [0.6.4] - 2026-08-13

### Fixed

- Generation now gracefully skips AI rules when no LLM is configured and continues even when individual rules fail

## [0.6.3] - 2026-08-13

### Fixed

- Server now logs a reachable URL when running outside dev environment

## [0.6.2] - 2026-08-13

### Added

- Unraid Community Applications template for installation
- Prerolls folder video adoption
- Homepage collection rotation
- Automatic screenshot capture on every UI change
- Studio redesign for admin app and portal

### Changed

- Development environment now uses localias (replaces portless)
- Screenshot capture optimization (parallel execution)

### Fixed

- UI failure message legibility, filter bar alignment, and sortable tables
- Page bottom gutter positioning below long content
- Production Docker image build and runtime
- Filter grammar and mobile role display refinements

## [0.6.1] - 2026-08-04

Hardening pass over the background job system, so it can be left running
unattended.

### Added

- **Settings → Schedules** — choose the timezone all job schedules are evaluated in. Previously schedules followed the container's clock with nothing showing what that was, and drifted by an hour twice a year at daylight-saving changes.
- Jobs whose scheduled time passed while Tinkerbell was down now run once on the next start, staggered a few seconds apart. Schedules that fire more often than hourly are skipped, and every decision is logged.
- **Generate Collections** and **Sync Media** record progress as they run and resume where they left off after a restart, instead of starting from zero.
- A separate queue lane for work you trigger and wait on — uploading a preroll no longer sits behind an hour-long nightly job.
- `LOG_LEVEL` (`debug`/`info`/`warn`/`error`) and `LOG_FORMAT=json` environment variables. Raising the level also surfaces the job engine's own internals.

### Fixed

- Long-running jobs could be silently re-run up to five times while the first was still going, re-applying label, overlay and personalization changes to your Plex server. The job engine's stale-job sweep had no heartbeat and treated anything running over ten minutes as dead.
- A single hung network request could jam the entire job queue indefinitely — no further jobs would run, and the container health check still reported healthy. Every outbound request now has a timeout, every job has a wall-clock budget, and a watchdog recovers runs that overrun it.
- Cancelling a job now actually stops it. Cancellation is reported when the job finishes unwinding, so the run's duration is the time actually spent, and a cancelled job can't be started again while the previous run is still stopping.
- A job with invalid configuration ran with default behaviour instead of failing. For **Remove Overlays** this meant silently _applying_ overlays instead of removing them.
- Jobs interrupted by a restart could resume against an already-finished run, corrupting its log and status.
- Requests to TMDB, OMDb, Overseerr, IMDb and the \*Arrs now retry transient failures. A single upstream blip at 1am no longer fails the whole nightly run.
- Job run logs stream incrementally instead of re-sending the entire log to the browser every second, and are capped so a failing job can't write an unbounded amount. The end of the log is always kept.
- The per-minute health check no longer writes an activity-feed event every time it runs when nothing has changed.

## [0.6.0] - 2026-08-04

### Added

- Preroll management — control which videos Plex plays before movies
- Public marketing website (tinkerbell.dev) with screenshot harness
- Portal background image upload
- Admin-customizable portal branding with auto-reconciliation on user sync
- Portal fuzzy title picker and mood selector with per-input help

### Changed

- Consolidated Personalization settings into Portal as tabs
- Added dedicated theming for the user portal
- Consistent headers and hierarchy across settings pages
- Node.js runtime updated to v26

### Fixed

- Mobile More sheet positioning below bottom navigation
- Error handling and reporting for failed API requests
- Accessibility improvements: focus rings, tap targets, reduced motion support
- Settings form consistency across Save/Test behavior
- localStorage access now guarded through a safe module
- Error boundary resets properly on navigation; fixed mobile overflow and dead drawer
- Safe-area insets, favicon, and document titles
- AI Prompt rules no longer fail on oversized libraries (now samples instead)
- Portal sign-out now updates immediately
- Portal rating slider and bias hints behavior
- Removed "not enabled yet" messaging from portal

## [0.5.0] - 2026-05-25

### Added

- Personalized home screens: an opt-in, server-wide mode (Settings → Personalization) that gives each Plex user their own home-screen collections by labelling the library and restricting sharing per user. Enabling snapshots prior sharing settings; disabling deletes per-user collections before restoring sharing, leaving the server as if it was never enabled.
- Per-user preferences (loved/liked/hated genres, moods, rating floor, content-rating ceiling, excluded titles, watched bias, row cap) that steer recommendations.
- Sign-in-with-Plex user portal (`apps/portal`) on its own port where users edit their own preferences without access to the admin API.
- Admin "User Preferences" editor under Settings.
- "Personalized Collections" feature: re-runs rules marked personalizable per opted-in user, shaped by their preferences.

### Changed

- Because You Watched now honours each user's preferences; it and the personalized features require the Personalized Home Screens switch to be enabled.

## [0.4.1] - 2026-05-04

### Added

- Phase 3 rule types: `based_on`, `seasonal`, and `awards`
- Phase 2 rule types for Kometa migration parity

## [0.4.0] - 2026-05-04

### Added

- Kometa to Tinkerbell migration support (Phase 1)
- Credits tab in Settings listing open-source dependencies
- Auto-applied Kometa default posters for collection artwork
- Per-rule pin-to-homepage option

### Changed

- Concurrent rule executions are now serialized
- Multi-collection rules now display a filtered collections list in View

## [0.3.1] - 2026-05-04

### Added

- Release script for automating releases

### Changed

- Trimmed changelog page preamble

## [0.3.0] - 2026-05-04

### Added

- Drag-to-reorder for stats panels.

### Changed

- Stats panels are now organized into per-component files.
- Replaced Plex-tag grouped rules with a TMDB-backed handler.

## [0.2.1] - 2026-05-04

### Changed

- Internal: split `commands/generate.ts` (1961 lines) into a `commands/generate/` directory with one module per concern — handlers as `AsyncGenerator<PendingCollection>`, shared `commitCollection` / GUID-indexing helpers, and a preview path that reuses the same handlers instead of duplicating their logic. No user-visible behaviour change.

## [0.2.0] - 2026-05-04

### Added

- Rule wizards for grouping by director, genre, network, country, and content rating.
- Popular Actors and Popular Directors rule wizards (TMDb-driven).
- Franchises rule wizard — auto-generates a collection per movie franchise the library belongs to.
- Send missing items to Radarr/Sonarr as a per-rule action — applies to any rule whose source can produce items not yet in the library, with dry-run, per-run cap, and live-fetched quality profile + root folder.
- Per-run \*arr add/skip/fail counts in rule history.
- TMDb integration with API key configuration, connection test, and health-dashboard status.

## [0.1.0] - 2026-05-04

First public beta.

### Added

- Plex collection sync with Tinkerbell-managed labels (`Tinkerbell` base, plus per-feature and per-user labels).
- Per-collection detail page with member listing and rule bindings.
- Auto-generated "Because You Watched" collections per user.
- Per-user collection scoping via `User:{plexUsername}` labels.
- Rule engine for automating collection membership and overlays.
- Visual rule wizard for creating and editing rules.
- AI-assisted rule wizard that drafts rules from a natural-language description.
- Live preview of rule matches before saving.
- Browse and search Plex media with detail views.
- Overlays for badging artwork (resolution, audio, custom labels).
- Smart filters editor for reusable media queries.
- Background job runner with cron scheduling.
- Live progress reporting (`§PROGRESS:current/total:message`) for long-running tasks.
- Per-run detail view with logs; cancel running jobs from the sidebar.
- Built-in commands: `shuffle`, `generate`, `because-you-watched`, `sync-collections`, `sync-media`, `sync-users`, `overlays`, `label`, `label-undo`.
- Dashboard with library stats and active stream count.
- Configurable stats panel (toggle which metrics appear).
- Preview page rendering the Plex home view as a given user would see it.
- Notifications via Discord, Slack, Telegram, Gotify, LunaSea, Pushbullet, Pushover, or generic webhook.
- Plex integration (local server + plex.tv) for media, users, collections, and labels.
- Sonarr / Radarr (the \*arrs) integration for upstream library state.
- AI provider configuration for the rule wizard.
- User management synced from Plex (using plex.tv usernames, not local display names).
- Health dashboard with per-service status indicator in the sidebar.
- Event log for auditing rule runs and sync activity.
- Stress-test tooling for load-checking the server.
- Command palette and keyboard shortcuts.
- Mobile layout with bottom-tab navigation and pull-to-refresh.
- Docker image with Unraid-compatible entrypoint.
- SQLite-backed configuration and state (`tinkerbell.db`).
- Monorepo layout: `apps/{server,web}`, `packages/db`, `clients/*`.

### Notes

- Tinkerbell is beta — expect rough edges and breaking changes before 1.0. Back up `tinkerbell.db` before upgrading.
