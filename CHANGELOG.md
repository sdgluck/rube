# Changelog

All notable changes to Tinkerbell are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Tinkerbell is currently beta software (0.x) — APIs, data shapes, and behaviour may change between releases.

## [Unreleased]

## [0.17.1] - 2026-08-15

### Fixed

- Fixed the app bar's height so it no longer changes by a few pixels when navigating between pages with different controls, which previously caused the page content to jump.
- The app bar no longer stays pinned to the top of the screen while scrolling; it now scrolls away with the page and returns when scrolling back up.

## [0.17.0] - 2026-08-15

### Added

- **Generated collections now get a description, and can get a poster.** Every rule writes a one-line summary onto the collections it builds — "Films directed by Christopher Nolan.", "Films released between 1980 and 1989." — the moment they're created. It's deterministic and free, and it's on by default for new and existing rules.
- Rules can now generate a **poster** for each of their collections, replacing Plex's grey four-poster mosaic. Three templates: a gradient plate with the title, a mosaic of the collection's own posters, and a spotlight on one member's artwork; the palette is taken from the films in the collection unless you pick an accent. Artwork is **off by default and opted into per rule** in the wizard's new "Look" step, which shows a live render before you commit to it.
- New **Settings → Appearance** page: the default template and accent new rules start from, and a master switch that stops every artwork upload at once without editing a single rule.
- New **Generate Collection Artwork** job, scheduled after the nightly rule run. Poster rendering is minutes of image work per library, and it has no business holding up the rules — it also skips any collection whose poster hasn't changed since last time, so a nightly run doesn't re-upload identical images to your server.
- For rules whose logic you define yourself — AI prompts, smart filters, external lists — the description can be **written by your configured AI provider** from a sample of what actually landed in the collection. Generated once and reused until the rule changes; falls back to the templated sentence when no provider is configured.
- A description you edit by hand in Plex is **detected and never overwritten again**, and "Revert artwork" on a rule stops all further uploads and forgets what was written.
- Registry packs now ship presentation settings, so an imported pack arrives looking designed rather than generic.
- New periodic **library digests**: a server-wide digest summarising library activity, and a per-user digest recommending titles filtered by that user's stated tastes. Both can be delivered to chat, and email delivery is new in this release.

### Changed

- **Cleanup rules (file/media deletion) now run as their own scheduled job, separate from collection-building rules, on their own 4am schedule.** Existing schedules that relied on cleanup and collection rules running together will need to be reviewed.
- **The cleanup delete ceiling is now enforced as a rolling 24-hour cap across all runs (scheduled, manual, and concurrent) instead of resetting for every individual run.** Previously, running several cleanup rules by hand, or restarting the container mid-run, could let far more deletions through than the configured limit. The setting is renamed from a per-run limit to `cleanup_max_deletes_per_day`; existing configured values carry over automatically.
- The UI has a new flatter visual style: square corners throughout (previously rounded), and floating drop-shadow panels replaced with hairline borders. This is a visual-only change with no configuration impact.

### Fixed

- The cleanup delete ceiling now actually holds across runs — it could previously be exceeded by running rules ad hoc or by a mid-run restart, both now covered by the same rolling 24-hour ledger described above.

## [0.16.2] - 2026-08-15

### Added

- Every search field in the app now has a clear button (an X once you've typed something) and supports Escape to clear it.
- Cleanup rules now have their own tab on the Cleanup page, separate from the queue.

### Changed

- The Rules page now shows only collection rules; cleanup rules have moved to their own tab under Cleanup.
- The changelog moved from the About page to Settings, and is now linked from the settings rail (the old `/changelog` link still redirects there).

### Fixed

- **If you've previously run the collection migration, it may have created a duplicate, disabled rule for every rule whose collection already existed on your server — a `scripts/dedupe-migrated-rules.mjs` script is now available to clean up the duplicates, and the migration no longer creates them going forward.**
- Rule links from the cleanup queue now correctly open the matching rule on the Rules tab instead of pointing at a parameter the page no longer reads.

### Removed

- The About page has been removed (the app version now shows in the sidebar, and its changelog link moved to Settings); the beta advisory it displayed is also gone.

## [0.16.1] - 2026-08-15

### Fixed

- The server-wide "not authenticated" warning no longer stretches to fill the page — on short pages like Cleanup it used to be pushed to the vertical middle of the screen. It's now a slim notice bar pinned above the page content.

## [0.16.0] - 2026-08-15

### Added

- **Tinkerbell now requires signing in with your Plex account to access the app.** Existing installs will be prompted to sign in on their next visit; each sign-in is bound to the browser that started it, and the admin and public-portal sign-in flows are kept fully separate.
- A new "Cleanup" action for rules: instead of only building a collection, a rule can now label or delete matching items in Plex (and, optionally, remove and unmonitor them in Radarr/Sonarr, with the option to delete files). It ships with safety rails — nothing is ever acted on the run it first matches, a rule that suddenly matches more than 25% of a section is treated as a filter mistake and refuses to act, a global per-run cap limits how much can be deleted across all rules combined, and the job refuses to run on a library index older than 48 hours.
- The rule wizard has a new Outcome step where you choose between building a Collection (the previous default behavior) or the new Cleanup action; choosing Cleanup shows a plain-English summary of what the next run will actually do once dry run is turned off, and switching from label to delete re-arms dry run rather than carrying over settings that were only safe for labelling.
- A new /cleanup page lists everything currently queued for a cleanup action and when it's due, and lets you grant any single item a 90-day reprieve ("Keep") — there is no button to action items early from this page.
- Notifications: a "cleanup pending" alert is sent before a cleanup run removes or labels anything, listing what's about to happen and linking to the queue page so it can be stopped; a "cleanup actioned" notification records what was actually removed.
- Settings gained a Cleanup section with the switch that enables cleanup actions across the app; without it, destructive cleanup rules refuse to run.
- Rules that pin generated collections to the homepage can now set a minimum item count a collection must reach before it earns a homepage row (off by default). Collections below the floor are still created in Plex, just not pinned. The registry's library pack ships its pinned rules with a floor of 3, which can be raised when importing.

### Changed

- **Links that used to jump to and briefly highlight a single rule (`?focus=`) now instead filter the Rules list down to that rule via the same `?q=` search used elsewhere**, so the link is shareable and survives a page reload; the list's type, enabled, and sort filters are now also saved in the URL.
- Collection generation is noticeably faster on libraries with many collections or rules with many groups: Plex collection listings are now filtered by label on the server instead of fetching every collection's labels one at a time, TMDb lookups are batched instead of made one request at a time, and a rule's collections are committed to Plex concurrently instead of strictly one after another.

## [0.15.0] - 2026-08-14

### Added

- The rule wizard's smart-filter editor now offers watch-history fields: watched by everyone, watched by nobody, watched by a specific person, total plays across all users, last played by anyone, and abandoned below a given percentage. They sit in their own group with a note, because Plex only ever reports the server owner's view state — so its "Unplayed" and Tinkerbell's "Watched by nobody" answer genuinely different questions. Inside an OR group they are shown disabled with the reason rather than hidden, since the local half of such a filter could never be recombined with what Plex returned.
- The collection drawer deliberately does **not** offer these fields. It edits a Plex smart collection, which Plex re-evaluates itself and cannot evaluate a field it has never heard of — so the drawer and its API reject them outright rather than letting the collection silently widen to whatever the remaining clauses matched.
- Smart-filter rules can now use those watch-history clauses, evaluated against Tinkerbell's own playback history after Plex returns its matches. The job log records both counts — what Plex returned and what survived the local pass — plus the resolved list of users counted as "everyone", so it is clear what a rule matched and why. Rules using a watch-history field warn in the editor while the playback record is still filling up, since a young history makes "watched by nobody" match almost everything.

### Changed

- **"Watched by everyone" now means everyone who has been granted access to the library, not just users who have opted into personalized home-screen recommendations.** Most people sharing a server never touch that setting, so on a typical install this previously matched nobody at all, making the rule silently useless. Existing rules using this condition will now match more users. The server owner is excluded from "everyone" by default — the new `watch_state_all_users_include_owner` setting includes them.

### Fixed

- Packs that reference a non-portable field (such as a filter tied to a specific user's Plex account id) are now rejected by the registry instead of being accepted and failing unpredictably for other users later.

## [0.14.3] - 2026-08-14

### Added

- The bandwidth test page now explains why its readings run higher than a browser speed test: it measures the server Tinkerbell runs on over multiple simultaneous connections, the way concurrent streams would, rather than one connection on your local device.
- Bandwidth test results now record how many parallel connections were used, so a figure can be compared against other tools or against future runs with a different connection count. Results saved before this change show as not recorded rather than guessing a value.

### Fixed

- The bandwidth tile on the Stats page no longer wraps onto a second line and grows the row when showing both the live and measured-capacity figures.
- The bandwidth history chart now scales its bars against the correct axis: it previously plotted upload bars using the download peak, making every bar far shorter than the axis label implied.

## [0.14.2] - 2026-08-14

### Fixed

- The bandwidth test failed immediately on every run, logging an error before any data was transferred. It now works end to end.

## [0.14.1] - 2026-08-14

### Fixed

- Fixed the "Last 90 days" heading on the Bandwidth Test settings page sitting flush against the block above it, which made it read as a caption for that block instead of the label for the chart below.
- The Bandwidth Test page's data ceiling is now shown as a whole number instead of a value like "200.0 MB", since it represents a limit to accept rather than a precise measurement.

## [0.14.0] - 2026-08-14

### Added

- A new Settings → Tools → Bandwidth Test page measures your server's upload and download speed, latency, and which Cloudflare edge answered, with 90 days of past results charted (failed runs marked rather than hidden) and a live progress view you can cancel mid-run.
- The Bandwidth Test page shows how much data a run will use before you start it, and warns if something is currently playing, since the test competes with live playback for the same connection.
- Bandwidth tests are limited to one every fifteen minutes, matching the cooldown Cloudflare enforces after repeated large tests.
- A new "bandwidth tested" event now appears on the Events page, flagging when a result comes back materially slower than usual, and can be routed to notification agents.
- The Bandwidth Test is listed as a system task so it can be scheduled to run nightly if you want a regular figure; it ships with no schedule by default so it doesn't compete with your own streaming.

### Changed

- **The Stats bandwidth tile now shows live session bandwidth as a fraction of your measured upload speed** (e.g. "8 Mbps / 100 Mbps", "8% of measured") once you've run a Bandwidth Test; until you run one it shows the same raw total as before, with a link to go run a test. After a month, it stops quoting a stale percentage and instead shows when the measurement was taken.
- The scheduled cleanup of old job history now also prunes bandwidth test results after 90 days, the same retention window already used for health checks.

## [0.13.1] - 2026-08-14

### Added

- Playback history columns can now be sorted, with sorting done server-side against the full history rather than just the visible page.
- The playback history page size is now selectable, from 10 to 25 rows.

### Changed

- **The playback history panel now defaults to showing 10 rows per page instead of 25.**
- Backfilled playback history rows (imported from Plex's watch history) now show the actual Plex username instead of a raw account ID like "User 548853984".
- Rows with blank Device/Play data, which come from backfilled history, now sort to the bottom of the playback history list in both sort directions instead of cluttering the first page.
- "Poll Playback Sessions" and "Import Plex Watch History" are no longer listed under Features, since they're not standalone installable features but the underlying poller and one-time seed for watch statistics.

## [0.13.0] - 2026-08-14

### Added

- **Tinkerbell now keeps its own playback history.** A new "Poll Playback Sessions" job samples what is playing every 30 seconds and records each play — who watched, how much of it they got through, on what device, and whether it was transcoded. It is enabled by default and starts recording as soon as you upgrade. Plex can tell you what is playing right now and that something was viewed, but not how much of it was actually watched; this is the data that watch-based collection rules and cleanup rules will be built on.
- A new "Import Plex Watch History" job seeds that history from Plex's own view log, so you are not starting from nothing. **It does not run on a schedule — run it once from the Jobs page after upgrading.** It is safe to re-run: it resumes from where it stopped and will not double-count plays already recorded live.
- New Stats panel showing recent plays with user, device, transcode decision and completion, paginated and filterable by period.
- Most Watched gains a 7d / 30d / 90d / All period selector, replacing the hardcoded "This Week".
- Media detail pages show a "Watched by" section — which users have watched the item, how many times, and when. This is the quickest way to confirm playback recording is working.
- The Users page shows a Plays column with each user's play count and total watch time.
- Two new settings: the completion threshold that decides when a play counts as "watched" (default 85% of runtime), and how long to keep raw session rows (default: forever).

### Changed

- **Most Watched and the dashboard activity tiles will read empty immediately after upgrading.** They previously came from an hourly cached snapshot of Plex's view log, capped at whatever fitted in its last 1,000 entries; they now read Tinkerbell's own playback history, which starts empty. Running "Import Plex Watch History" once fills them back in — after which the counts are exact rather than capped and up to an hour stale.
- History entries imported from Plex's view log are shown differently from plays recorded live, because Plex's log records only that something was watched — no completion percentage, no watch time, no device. A tooltip explains the distinction rather than showing a misleading 0%.

### Removed

- The hourly `sync-most-watched` job. Its job row is deleted automatically on upgrade, so the scheduler stops firing it.

## [0.12.0] - 2026-08-14

### Added

- The Jobs page is now a customisable dashboard, like Stats: drag its five panels (Recent Runs, Upcoming, System Tasks, Your Features, Recent Logs) into your preferred order and pick from 13 summary tiles (Features, Paused, Next Run, Last Duration, Failing, Never Run, and more) to show at the top. Your layout is saved per install.
- Job feature rows now have a Run button for running them on demand.

### Changed

- Every page now shows its title, breadcrumb, and action buttons (Import/Export, library picker, etc.) in a single sticky bar at the top instead of a separate heading on each page. Drill-in pages (e.g. a job's runs, a media item's detail) show the record's name in the back link instead of a page heading.
- **Enable/Disable Personalized Home Screens and Process Prerolls are no longer listed as features you can enable on the Jobs/Features page.** They're still there, just moved: trigger them from Settings → Portal → Personalization and from the Prerolls page respectively. Their runs still show up in Recent Runs and Recent Logs as before.
- Row actions across all list pages (Rules, Collections, Jobs) are now consistent: the main action is an icon button on the row, everything else is behind a "…" menu with destructive actions separated at the bottom. Rules rows go from seven separate buttons to a Run button plus a menu, and Collections' bare red Delete button is now in the menu.
- Bulk selection toolbars are now the same across every list page, and the button to clear a selection is labeled "Clear" everywhere (it was "Cancel" on Rules).

### Fixed

- The Jobs "Upcoming" panel no longer reads "in in 51s" for scheduled runs.

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
