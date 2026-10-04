# Changelog

All notable changes to Tinkerbell are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Tinkerbell is currently beta software (0.x) — APIs, data shapes, and behaviour may change between releases.

## [Unreleased]

## [0.31.0] - 2026-10-04

### Added

- Settings → Portal → Components lets you switch off each portal tab, each tastes section, and the Not for me / Keep this actions. A switched-off part is hidden from users, and so is anything its feature can't back: "Leaving soon" disappears when cleanup is off, and the digest address section disappears when SMTP isn't configured. The admin page names what's missing and links to it.
- The Feature Wizard for Personalized Collections offers, ticked by default, to mark every collection rule as personalizable. Cleanup, playlist and metadata rules are skipped.
- Bulk edit has a Personalizable on/off option, and the rule wizard has a per-rule Personalizable checkbox.
- The tastes form's genre list folds down to the user's picks, with the rest behind "Show all" and a filter.

### Changed

- **Switched-off portal features are refused on the server, not only hidden.** Requests to a disabled portal feature return FORBIDDEN. Saving the tastes form drops answers for a hidden section, and they come back when the section is switched on again. Withdrawing a keep vote is always allowed, so turning voting off can't leave a vote stuck.
- The tastes form's buttons are labelled Love, Like and Avoid instead of symbols that needed a hover to explain.
- Changes to a rule's personalizable flag are recorded in that rule's history, so each one can be reverted on its own.

### Fixed

- The Feature Wizard for Personalized Collections installed without error but did nothing, because no collection rule was marked personalizable. It now marks them.
- Saving a rule in the rule wizard no longer drops its personalizable flag.

## [0.30.0] - 2026-10-03

### Added

- Radarr and Sonarr quality profiles can now be managed from a new instance page (`/arrs/:instanceId`). It lists every profile with its managed status, applies a curated quality preset to a new or existing profile after you preview the changes, and can restore a profile from the snapshot taken before each apply.
- Radarr and Sonarr quality presets are built in, derived from TRaSH Guides, with size limits and a custom format library. A nightly check compares managed profiles against their preset and flags any that have drifted.
- Jobs → Schedule is a new tab showing every job that runs at a time of day as a block on a 24-hour or 7-day timeline, grouped by queue and sized by typical run time. Drag a block, or focus it and use the arrow keys, to move it. Repeating jobs get a frequency picker. Presets pack the nightly chain by measured run time. Edits collect in an undoable draft that is validated as you make it, and Save writes everything at once.
- Settings pages now show live status in place of the explanatory text: Plex Pass status on prerolls, today's spend beside each daily cap, whether the backup folder sits on a mounted volume, the asset folder's poster count, unlabelled libraries, the watchlist account and its last check, and Sign in with Plex during setup.
- A Detect button finds the Telegram chat ID for you.
- Settings → SMTP has an Encryption select, and time ranges show where they end.
- Rule wizard: triggers show a cadence badge instead of a paragraph, and the wizard offers schedule presets, a month/day window, token insertion and a language picker.
- Rule wizard: rule types whose service isn't configured are dimmed and link to the page that sets it up. OMDb and TMDb now link to their own settings rather than Settings → AI.
- Empty states on several pages now have sync and import buttons in place of instructions.
- Library and rating pickers have an explicit "All" / "No limit" option.

### Changed

- **Schedules moved from Settings → Schedules to Jobs → Schedule. The old address redirects, but existing schedules are not touched.**
- **Onboarding's "Use recommended" now moves untouched default jobs into the maintenance window it recommends, instead of leaving the midnight syncs running alongside generate. If you accepted the recommendation before, check your job times.**
- Successful outcomes such as saves and syncs now appear as toasts rather than modals.
- Status that was previously described in prose is now shown as status pills.
- Page intros and step intros in the rule wizard have been removed, and the remaining hints are a single clause each.
- Backup links to its job's schedule rather than repeating it on the settings page.
- The portal's genre legend is now made of buttons.

### Fixed

- Screenshots of the rule wizard now match its corrected Smart Filter copy, and unconfigured rule types appear disabled.

## [0.29.0] - 2026-10-03

### Added

- Feature install is now configured up front. The Add Feature wizard lists every feature, including Digest, which previously could not be installed, and each card says what is still needed before it will work. The Configure step shows the same settings form as the feature's page, and the review lists what you customised.
- Job pages now include a "What this needs" checklist of prerequisites set elsewhere: Plex connection, personalization, an AI provider, a digest channel, SMTP, overlays and backups. Each item shows as met or missing with a link to where it is set. Feature pages always show it; system pages show it only when something is missing.
- Personalized Collections can be limited to chosen opted-in users and chosen personalizable rules. A named user who has not opted in through the portal is skipped and logged. Because You Watched also gets a user picker.
- Run Now is a split button offering each job's one-off variants: preview or run the duplicate sweep for real, force re-render collection art, remove overlays, and send only the server digest. A variant applies to that run only, and the run history records it, so a dry run is easy to tell apart. Variants that would change nothing for the job as configured are not offered.
- Settings → Digest shows a summary of the Digest job (on or off, schedule, period, anything still needed), or an Install button if it is not installed.
- Job settings for every job now use one shared form. Digest's five settings, the duplicate sweep's preview-only switch and Metadata's rules-at-a-time setting appear on their job pages for the first time.
- Phone layouts of the portal fit the screen without sideways scrolling: tighter gutters, stacked genre controls, equal-width tabs, and a tappable pill remove button.

### Changed

- **The backup schedule set in Settings → Backup now drives the Back Up Database job.** Previously it was saved to a setting that nothing read, so backups ran on the job's own schedule regardless of what was typed. On upgrade, a customised backup schedule is copied to the job once (only if the job is still on its default schedule), and the old setting is removed. Check the job's schedule after upgrading.
- **Settings for a job now save together with its schedule, and a field set back to its default is stored as unset** so it follows future default changes.
- Deleting a Because You Watched collection asks for confirmation inside the app rather than in a browser dialog.
- A job page for a feature that is not installed says so, rather than showing "Job not found".
- System jobs (Cleanup, Metadata, Backup and others) are listed under System Tasks rather than Your Features, and their Remove button is gone. System Tasks shows "Required" only for always-on jobs and a working toggle for the rest.
- Feature install and uninstall are recorded in change history.
- Digest no longer shows a library picker that its command never read. Posters refresh no longer shows a library picker it ignored.
- The portal no longer shows the "These are yours" copy.

### Fixed

- Saving a job no longer wipes its other settings. Saving Remove Overlays previously dropped its mode, so the job started applying overlays instead of removing them. Saves now merge with the existing configuration.
- Every job's settings are checked against that job's own rules when saved, installed or run, so invalid values are rejected up front.
- Remove Overlays' mode is fixed to remove, and always-on jobs can no longer be disabled.
- Metadata Overrides has a job entry, so it can be run.
- Personalized Collections rows for users or rules you have dropped from the target are deleted at the start of the next run, so they do not stay pinned to anyone's home. Only collections carrying Tinkerbell's User and Rule labels for a known user and rule are removed.
- The job run page's breadcrumb shows the job's name.
- The portal's digest email input is styled to match the rest of the form.

### Removed

- Backup schedule setting in Settings → Backup no longer exists as a separate value; it is now the Back Up Database job's schedule (see Changed).

## [0.28.0] - 2026-10-03

### Added

- Portal address setting: Settings → Portal → Address now sets the public address viewers use to sign in to Plex through the portal. It is used for the sign-in link, cleanup warning links and the portal preroll. The address must be a full http or https URL, and the save is rejected otherwise, since a bad value would break every portal sign-in.
- Portal preroll: Settings → Portal → Preroll lets you design a preroll card (headline, message, sign-in address, optional QR code and colours). It is rendered to a video clip and added to your preroll pool as a portal preroll, so it can be ordered, enabled or disabled, and synced to Plex like any uploaded preroll. The Settings preview shows the card as it will appear.

## [0.27.0] - 2026-10-03

### Added

- Media page can now filter by Plex label. Labels are indexed during media sync and kept up to date when you edit them, so the filter works instantly, and it carries into a rule created from the filtered view.
- Rule conflicts are grouped by the set of rules involved, with links to each rule and its duplicates.

### Changed

- **Personalization labelling now only touches items that are missing the label.** Enabling personalization used to re-label the whole library on every run at roughly 3 items/s, against an assumed 25. It now labels in batches of 100 per request and removes labels using the explicit removal form. The measured speed is recorded and used for the next time estimate.
- Personalization enable and disable jobs now have a 2-hour budget.

### Fixed

- Cancelling a timed-out personalization enable no longer leaves it marked as enabled with 0 of 16 users restricted.
- A personalization disable no longer clears every sharing backup when some restores fail. Jobs that are aborted or only partly successful stay in the enabling or disabling state rather than reporting completion.
- Pending catch-up starts are cancelled when a schedule is cleared, so they can't fire after their container is gone.
- Rule run history retention is now enforced correctly when several runs finish in the same millisecond, so the retained count can no longer exceed the cap.
- Stress-test telemetry now includes the final reading taken after the sessions drain. Previously it could be dropped on slow runs, leaving the chart ending mid-measurement.

## [0.26.0] - 2026-09-28

### Added

- The stress test page is now a live cockpit while a run is in progress. It charts per-session speed, total bandwidth the server is pushing, bandwidth the clients actually pulled off the wire, and stream successes and failures. It labels the settle period before each step, so the flat stretch reads as waiting for the transcoder rather than a hang.
- A finished stress test can be replayed from its stored data, with a crosshair readout on the charts. Runs recorded before this release still draw their capacity curve.
- Stress test results now record total bandwidth across all sessions and the bandwidth the clients actually received. A server under pressure can keep reporting a stream long after it stops delivering it, and the two figures together show that.

### Changed

- The stress test now takes one continuous set of readings for the whole run. The chart and the pass/fail verdict use the same readings, where before they could differ.
- For long stress test runs, the stored chart data is capped. When a run goes past the cap, the older half is thinned out and the recent samples are kept, since the end of a run is where the degradation shows.

### Fixed

- **Always-on system jobs that had been switched off are now switched back on at startup.** Jobs marked "Required" or "Always on" could end up disabled, for example from an older build, a settings import or a manual edit. They then silently never ran, and the toggle was hidden so there was no way to re-enable them. Startup now repairs those jobs and logs which ones it fixed.
- The "Required" and "Always on" labels on jobs now show the job's real enabled state instead of always claiming it is on.
- Stress test sessions no longer show up as real viewing. A twenty-session ramp used to add twenty plays by the server owner to playback history. It also put a bandwidth spike in the stats that no viewer caused, and showed on the dashboard as load. These sessions are now excluded from playback history, the bandwidth series, the dashboard and the session lists. If someone is genuinely watching when a stress test starts, their play is still recorded.

## [0.25.0] - 2026-08-21

### Added

- Menu items can now be hidden and reordered within their section, sections can be reordered, and any route can be assigned a slot in the mobile tab bar. Edit the menu from an "Edit menu" control on the sidebar, or from the same editor on /more on mobile.
- Discover has a new Lists tab for searching MDBList and Trakt by name, previewing what a list holds against your own library, and creating a rule from it directly.

### Fixed

- Screenshot capture no longer opens the menu editor instead of the collection edit dialog when regenerating collection screenshots, which had been breaking the whole capture suite.
- The stress-test harness works again — it had been failing instantly on every run since a prior refactor left its worker process without a message listener.
- Stress-test transcode sessions are now genuinely concurrent instead of collapsing to a single session, because the harness now makes the transcode decision call Plex expects before starting playback.
- The stress-test harness no longer risks marking finished, fully-watched items as unwatched during its own cleanup.
- The stress-test harness's direct-play mode can now detect and report server degradation, which previously had no signal to measure against.
- The stress-test harness no longer floods the server with requests for video segments that don't exist yet, and no longer counts "not ready" as a failure.
- The stress-test harness re-measures a degraded reading before reporting it, instead of letting one bad moment permanently understate server capacity.
- A cancelled stress-test run is no longer recorded as completed.
- The stress-test page is no longer hidden in release builds.

### Fixed

- **The stress test never ran.** Every run failed within milliseconds of
  starting, reporting only "Worker process exited unexpectedly" — the harness's
  child process had lost its entrypoint in a refactor and did nothing at all.
  It works again, and a test now forks the real worker so this cannot recur
  silently.
- **The stress test could erase watch history.** Items were filtered on playback
  position alone, so a film you had already finished — which has a view count
  and no position — could be picked, played and then permanently marked
  unwatched by the run's own cleanup. Finished items are now skipped.
- Direct-play stress tests always reported the configured session cap as your
  server's capacity. With no transcoder to measure, the run had no health signal
  at all and could never detect degradation; it now watches session dropout and
  stream throughput instead.
- **Transcode stress tests never ran more than one stream at a time.** The
  harness started transcode sessions without first registering a playback
  decision with Plex, which makes the session a throwaway: the server discarded
  each one as soon as the next began, so a run that reported "4 sessions" had
  only ever had one alive. Verified against a real server — 1 of 5 sessions
  survived before the fix, 5 of 5 after — and the server's own transcode
  session count now tracks the ramp exactly.
- The stress test stopped at the first bad reading, so one unlucky measurement
  permanently understated a server. A degraded step is now re-measured before
  the ramp stops, and readings that don't reproduce are reported as transient.
- Stress sessions raced the transcoder, issuing hundreds of requests a second
  and mostly receiving 404s for segments that did not exist yet; they now
  consume at playback pace. Segments that aren't ready are no longer counted as
  failures.
- A cancelled stress test was recorded as a completed one.
- A single transient Plex error mid-run was reported as your server's capacity
  limit; it now takes a majority of failed samples to end a run.
- Fixed transcode stress sessions failing to stream on servers that return an
  absolute playlist URL, and segment URLs being resolved incorrectly when the
  playlist URL carried a query string.
- Direct-play stress sessions now stream the actual media part and walk through
  the file, rather than re-reading its opening seconds from the server's cache.
- A stress test worker that failed to start could crash the whole server
  process; a run interrupted by a restart is now stopped rather than left
  orphaned against your Plex server.

### Changed

- The stress test is no longer hidden from release builds — it is available at
  Settings → Stress Test in every environment, with a caution about what it does
  to your server. Past runs now show their outcome and keep their logs, and the
  API enforces the same 1–50 session bound the form does.

## [0.24.0] - 2026-08-20

### Added

- Added a **/discover** page to search TMDb for films and shows in a single grid, showing which results your \*Arr instances and Plex already have, and send new picks to the instance, quality profile and root folder you choose.
- Added a record detail page for movies and series in the unified \*Arr library (`/arrs/:instanceId/movies/:arrId` and `/arrs/:instanceId/series/:arrId`), showing seasons and episodes with an interactive release picker for series — previously these links redirected to the stats page instead.

### Fixed

- **Existing installs may have \*Arr library entries incorrectly showing "Not in Plex."** The \*Arr media sync now relinks its library mirror to Plex on every run, instead of only when a Plex library sync happened to run afterward — on some installs this mismatch could persist indefinitely until an unrelated sync corrected it.
- Fixed a bug where a missing setup step (such as an unconfigured connection) reported by the \*Arr search/add feature could appear as a broken upstream service error rather than a configuration prompt.

## [0.23.1] - 2026-08-20

### Security

- Closed two gaps in the guard on outbound requests to addresses Tinkerbell should never fetch. An IPv4-mapped IPv6 literal (`[::ffff:127.0.0.1]`) and a hostname with a trailing dot (`127.0.0.1.`) both reach loopback but neither was recognised, so a notification webhook or preroll URL pointing at one was allowed through.

### Fixed

- Saving a configuration value now rejects an invalid one instead of storing it. Previously a value outside its allowed range was written without complaint and then threw on every subsequent read — and because saving reads the old value first, the setting could not be corrected either. A single bad write made that setting unusable until the database was edited by hand.
- The "suggest a name" step of the rule wizard now produces a name for every rule type. Ten of the twenty-nine — Decades, Years, Resolutions, Awards and others — suggested nothing at all, which left the name blank, the Save button disabled, and no explanation of why.
- An AI provider replying with only whitespace is now treated as a failure rather than as an empty answer. A rule using it would otherwise build nothing, every night, and report the run as successful.
- Backup and history source files no longer contain a literal NUL byte, which made search and file-type tools treat them as binary and skip them silently.
- `pnpm lint` no longer hangs when a development worktree is present on disk. It scanned every file beneath it, `node_modules` included.

### Changed

- Tinkerbell now runs its full test suite, type checks and linting on every change, and no image is published until they pass. None of that was automated before, so the checks only ran when someone remembered — and one of the fixes above is a defect that had been sitting on the main branch as a result.
- Test coverage was extended across the code that changes things you cannot easily get back: deleting media through Radarr and Sonarr, changing what a shared user can see, applying database migrations on upgrade, reordering poster overlays, and pruning old backups. This does not change behaviour on its own; it is what stops the behaviour changing by accident later.

## [0.23.0] - 2026-08-20

### Added

- **Tinkerbell can now browse and manage your Radarr and Sonarr libraries.** A new "Managers" section in the sidebar adds Movies, TV, Downloads and Instances pages, so the everyday questions — what's monitored, what's missing, what's downloading — no longer mean opening three tabs.
- Movies and TV list every configured instance together in one sortable, filterable table, and you can monitor, unmonitor, search for and remove items without leaving Tinkerbell. If you run a split setup (a 1080p Radarr and a 4K one, say), both appear side by side with an instance column and a picker to narrow to one.
- **A new health page finds the things neither Radarr nor Plex can see on their own** — titles that are on disk according to Radarr but that Plex has never scanned, releases that were grabbed but never imported, films held by more than one instance, and items in Plex that nothing is managing. Each finding explains what it means and whether it is a fault or just worth knowing.
- The Downloads page shows every instance's queue together with live progress, and surfaces the actual error when an import is blocked rather than just the word "blocked". An Activity tab lists recent grabs, imports and failures across all instances.
- The Instances page shows each Radarr and Sonarr with its version, item count, queue, free space on the volume the library actually lives on, and when it last synced — with the full error text if it is unreachable.
- Multiple instances of each service are supported throughout, and one being down no longer affects the others: a failed sync is recorded against that instance alone and retried on the next run, leaving its existing data untouched.
- A nightly "Sync Radarr & Sonarr" job mirrors your libraries locally so these pages load instantly instead of waiting on each server, and a lightweight poll keeps the Downloads count current. Both appear in Jobs and can be run on demand.
- Tinkerbell now records the provider IDs (TMDb, IMDb, TVDb) of items in your Plex library during the regular media sync, which is what lets a Plex item and a Radarr record be matched reliably rather than guessed at from titles and years.
- This release covers browsing, monitoring and searching. Editing an instance's own settings — quality profiles, custom formats, indexers, download clients — is not included yet; keep using Radarr's and Sonarr's own settings pages for those.

## [0.22.0] - 2026-08-20

### Added

- Plex watchlist syncing: items you add to your Plex watchlist are now automatically searched for and requested via Radarr/Sonarr, without needing any new credentials or third-party service. This runs as a background job roughly every fifteen minutes, only considers the server owner's watchlist, and defaults to dry-run so nothing is added until you turn it on.
- A "Try again" button for watchlist items that were skipped (for example because Sonarr had no root folder configured at the time) — you no longer have to remove and re-add the item in the Plex app to retry it.
- An optional setting to automatically remove an item from the watchlist once it becomes available in your library (off by default).
- A safety cap on how many requests the watchlist sync can make in a single run, shared across Radarr and Sonarr and counted even during dry runs, to avoid large bursts of requests when a watchlist is first synced.

## [0.21.0] - 2026-08-20

### Added

- New "History" entry in a rule's row menu shows every past edit to that rule, with a restore option that reverts it to the selected version.
- Tinkerbell now records a change history for rules, config values, job schedules, overlay presets and prerolls, capturing the full state before and after each edit. Secrets are redacted before being stored.
- Added configuration export and import: export bundles rules, job schedules, overlay presets/layouts and settings into a single JSON file; credentials are excluded by default (with a warning if you choose to include them), and authentication state is never exported.
- Import previews changes before applying them, classifying each item as new, identical, or differing from your current setup, and lets you choose to keep your existing configuration or take the incoming version for anything that differs.
- **Tinkerbell now takes a nightly database backup by default at 03:30, gzipped and keeping the last seven copies.** Backups use SQLite's online backup mechanism so they're safe to take while the app is running; restoring from a backup is a manual, documented procedure.

### Fixed

- Fixed rule value pickers and filters for studio (and other tag) fields on `show.`-prefixed and `episode.`-prefixed fields, which previously returned no options at all because the lookup used the wrong field name against Plex.
- Fixed a bug where exporting rules containing tag fields (like studio) produced values that only matched correctly on the server they were exported from; exported tag values are now translated to portable display names and translated back to the correct local keys on import.

## [0.20.0] - 2026-08-20

### Added

- **Kometa migration now reads your actual `config.yml`**, not just the collections it left in Plex — templates, includes, filters, limits, schedules, posters, sort titles, overlays (mapped to badges), metadata files (mapped to per-item overrides), playlists, and asset-directory artwork are all carried across. Each migrated rule is scored for confidence, lists anything it couldn't take, and is created switched off with a dry-run diff against the collection it replaces so you can check it before turning Kometa off.
- New rule capabilities added to support that migration: include/exclude on grouped rules, collection mode/sort/sort-title, a `static_list` rule type for adopting unmappable definitions, and Trakt public list rules.
- Metadata rules: a new rule type that writes fields (title, sort title, content rating, studio, genres, etc.) on a schedule, with templating tokens, field locking, a daily write ceiling, and full undo. Build one in the wizard at `/metadata`, or edit a single item's metadata directly from its detail page — both go through the same undoable snapshot ledger, with a Settings → Metadata page for the master switch, write ceiling, and history.
- Rules can now run on their own schedule, a seasonal on/off window, or a trigger (item added, item watched, item removed, Overseerr request fulfilled) instead of only inside the nightly batch — and one rule can chain to run after another finishes.
- Rules now have a position with drag-to-reorder, and the app detects when two rules are about to conflict (same collection name, same metadata field, or a cleanup rule racing a collection rule).
- Rule test/funnel tooling: the Test button shows a clause-by-clause funnel explaining why a smart filter returned what it did; a real nightly run that comes back empty now stores the same funnel so you can read it the next morning; and you can ask "why is this item (not) in this rule's results?" for a single item.
- Rule runs are now tracked as server-side rows: progress, log and status survive a page reload, a closed tab, or a lost connection, and a run in progress can be reattached to instead of started twice.
- Every rule run now diffs the collections it touched against last time and stores the changeset, with a Revert to undo just that run's Plex changes.
- Deleted rules can be restored (Undo) within a day of deletion.
- Cleanup queue overhaul: search, filters by rule/action, a due/waiting/held view, sortable columns, batch Keep/Release with its own Undo, and a configurable hold duration.
- Cleanup: standing (never-expiring) protections by item or by collection, on top of the existing time-limited holds.
- Cleanup: an optional approval gate — when turned on for a rule, matched items still queue but nothing is deleted until a human approves that specific item.
- Portal: shared users can now see what's queued for removal from their libraries and vote to keep something (a request to the admin, not an override); a "Not for me" button on their own collections now actually excludes that title from future recommendations; and search, leaving-soon and digest are scoped to each user's actually-shared libraries instead of the whole server.
- Multi-instance \*Arr support: configure more than one Radarr/Sonarr (e.g. a split HD/4K setup), point auto-add and cleanup rules at a specific instance, and get a separate health check per instance.
- Notifications: Settings → Notifications now shows a routing table (event × service grid) with a test-send per cell, instead of nine separate forms; a failure threshold, quiet hours and a per-service mute (all off by default) stop a flapping service from paging you all night; and suppressed notifications are now logged so you can tell "quiet hours" from "webhook is broken."
- Onboarding: a skippable, resumable setup wizard at `/onboarding` for fresh installs, with a progress banner elsewhere in the app.
- Media page: file-size tracking per item (shown in Cleanup and Media), a duplicate finder for both Plex's own multi-version items and separately-matched duplicate items, bulk selection with bulk labelling, and item-detail actions for refreshing metadata, editing tags/genres/labels, and viewing edit history.
- Media detail page now names which rule produced each collection an item is in (in plain English) and adds "Open in Plex" / "Edit the rule behind this" links.
- New `/changes` page: a single read-only feed of everything the app changed (collections, metadata writes, deletions, deleted rules), pulled from existing records rather than a new log.
- New `/users/:userId` page for managing Plex users without leaving Tinkerbell: invite, library access, downloads, Live TV, rating ceiling, and session termination.
- Stats dashboard: panels can now be hidden and collapsed individually; five new panels (Top Users, Playback Activity, Stream Quality, Devices & Apps, Bandwidth); TV libraries are now included in storage totals; byte sizes now scale to TB/PB instead of wrapping; and Most Watched can count each person once instead of ranking by total plays.
- Jobs page: a 24-hour timeline of job-lane activity, watchdog failures now shown distinctly from command errors, and a banner when a run resumes from a checkpoint after a restart.
- Web/UI: a light/dark theme toggle independent of your OS setting; a skip link and route announcements for screen readers; command palette scoping (`rule:`, `job:` prefixes), recent destinations, and running/testing rules or jobs directly from it; saved list views with shareable URLs; "create rule from this view" on the Media page; a searchable settings sidebar; and a cron field that previews its next three fire times in your schedule's timezone.
- Heavy jobs (rendering, overlay burn-in, preroll transcodes) can now wait while someone is streaming and/or be confined to a time window — both off by default.
- Cleanup rule wizard now leads with four common presets (not watched in a while, never watched, watched by everyone, started and abandoned) instead of the full 29-type list.

### Changed

- **Cleanup rules no longer build a preview collection in Plex.** The "on the chopping block" shelf is gone — existing ones are automatically removed on a rule's next run — in favour of the in-app Cleanup queue, which shows the same information with more context and a way to object.
- **Rule execution order is now actually enforced.** Where two rules write the same field or build the same collection, the one earlier in the (now reorderable) rule list wins consistently, rather than whichever finished last in a race between concurrent workers.
- Rule runs from crons, triggers and chains now go through a single shared queue with coalescing, rather than four separate execution paths with weaker guarantees than the nightly batch; a second identical run now writes nothing to Plex instead of deleting and rebuilding collections that didn't change.
- Scheduled jobs held back during a maintenance window or "defer while streaming" now apply to a wider set of triggers (per-rule crons, playback polling, recently-added sync, Overseerr polling), and a missed run caught up after a restart is now deferred like any other scheduled start instead of firing immediately.
- Maintenance windows, seasonal rule windows, and Stats' "today" boundaries now use your configured timezone instead of the container's clock — installs running outside UTC will see these fire at different, correct times after upgrading.
- A cleanup rule's "three runs in a row" streak now advances at most once per calendar day, closing a loophole where frequent triggers or repeated "Run now" clicks could reach the deletion threshold in under an hour.

### Fixed

- **A stale/incorrect API key exposure**: every additional Radarr/Sonarr instance's API key was being sent to the browser in full on every admin page load. Now redacted like all other secrets.
- **A portal sign-in weakness** where a crafted request could redeem another user's Plex sign-in PIN and obtain their session. The portal's handshake is now scoped and namespaced like the admin app's.
- **A partial sync of one library could delete data for your other libraries**, and could also wipe cleanup protections tied to collections that weren't part of that sync — potentially letting a rule delete a protected item. Syncs now only touch the sections they actually walked.
- **The consent default on `user_preferences.opted_in` flips from "consented" to "not consented"** for existing rows (migration included) — a genuine default-behavior fix, not just new installs.
- A paged Plex library listing that omits its total size was silently treated as "only one page" — could under-report the media index, storage totals, and duplicate detection until this release.
- Cleanup only deleted from the first \*Arr instance holding a record, so a split HD/4K setup could see a "deleted" film reappear overnight; it now checks every instance.
- Renaming an extra \*Arr instance used to silently detach its health history and mute settings from it.
- The failure-threshold/streak logic for health checks could get stuck out of sync with its own recovery condition when the threshold was changed mid-outage; a service's very first failing check after setup was previously swallowed entirely.
- The notification routing table now shows an "unconfigured" state for services with no credentials, instead of showing them as actively delivering.
- Several Stats numbers were wrong by construction rather than stale: TV libraries reported ~0 episodes, storage totals for partially-measured shows silently under-counted with no caveat, unidentified viewers were miscounted as a single viewer, "transcoding" was defined two different ways on the same page, and Most Watched could drop its #1 item after sorting.
- Duplicate detection ignored a resolution above 4K (e.g. a reported `2160`), tying it with unknown-resolution copies.
- Boot-time job catch-up bypassed the "defer while streaming"/maintenance-window checks entirely, firing missed jobs immediately into an open stream.
- Job-runner side-effect hooks (notification logging, health reporting, migration rescans, per-user collection counts) were silent no-ops for every job run in the background worker thread — they now actually fire.
- Rule-run bugs: undo of a deleted rule lost its position and jumped to the front of the run order; a chained rule could run twice in one tick; contention (a rule already running) was reported as a failure instead of a skip; "why did this rule skip my item" used a different scope check than the engine; and metadata rules could report "nothing to change" when matches were only blocked by locked fields, not actually empty.
- Portal: "Not for me" previously wrote to the wrong list and did nothing; saving portal preferences wiped fields the portal form doesn't render (people, eras, runtime, languages, vibe, rating ceiling); a shared user could vote to keep items from libraries they don't have access to; and a per-user data query was vulnerable to `LIKE`-pattern injection via username.
- Onboarding's setup wizard could hijack an already-configured, upgraded install into first-run mode.
- Various smaller reporting/label bugs: the Runs column could link to the wrong run when two runs started in the same millisecond; drag-reorder on the Rules page could silently misplace rules outside the currently filtered view; an unimplemented portal API path served the SPA with a 200 instead of an error; and a failed hub shuffle could leave home-screen pins missing instead of restoring them.

### Removed

- The "on the chopping block" Plex collection that cleanup rules used to build as a preview of pending deletions (superseded by the in-app Cleanup queue — see Changed).

### Added

- Five new Stats panels: **Top Users** (who watches most, and for how long), **Playback Activity** (plays by day, or by hour of a typical day, with the busiest and quietest stretches called out), **Stream Quality** (transcode vs. direct play, local vs. remote, over a period rather than this instant), **Devices & Apps** (which apps and devices playback actually comes from), and **Bandwidth** (24 hours of streaming demand against your measured upload capacity).
- Stats panels can be switched on and off individually, from a new panels button beside the tile picker. Panels added in a later release are shown by default rather than staying hidden behind a saved layout.
- Stats panels can be collapsed to their title by clicking it. A collapsed panel stops making requests entirely, so rolling up Active Streams also stops it polling Plex every five seconds.

## [0.19.0] - 2026-08-16

### Added

- Collection page: labels in the header are now clickable pills that link to the Collections list filtered to that label.
- Collection editing moved into a dedicated three-step wizard (opened via an Edit button), matching the rule wizard's style, with a review step before anything is saved.
- Smart filter collection summaries are now written as natural-language sentences (e.g. "Horror films released in the last 10 years that you haven't watched") instead of a clause-by-clause restatement of the filter, and genres are shown by name rather than numeric tag ID.
- Collections table gains six new optional columns — Poster, Pinned, Summary, Artwork, Last synced, Rating key — configurable the same way as Media's columns; Pinned is shown by default.
- Collection detail page rebuilt with Items / Details / Activity tabs: a poster studio (generate from a template, upload, pick an existing Plex image, or fetch an allow-listed URL), manual pin/unpin to the Plex home screen with live state, membership editing (add/remove items) on static collections, and visibility of library order, runtime, year span, genre mix, watched share, sibling collections from the same rule, and who/what last set the poster and summary.
- Active Streams table columns are now configurable, adding audio, playback decision, device, app, location and time-left.
- Users page: the "Last Watched" title now links to the item (only for history synced after this release).
- Sidebar footer: hovering the version now shows the commit the running build was made from (Docker builds only).
- Bandwidth tile on Stats now tracks usage over the last 24 hours as a sparkline of hourly peaks, instead of only showing the current instant; a week of samples is kept.
- Stats tiles for Failed Jobs (24h), 4K Library, Top User and Last Sync are now clickable and link to a filtered view of the relevant page; Active Users (7d) and Movies/Episodes show a 14-day sparkline instead of a blank or redundant sub-line.
- Jobs page can be filtered by status (failed / running / never run), with a banner explaining the active filter and a link to clear it.
- Media table can now be sorted by "Added" date and ships an Added column by default.

### Changed

- Breadcrumb trails now live only in the top app bar; the duplicate breadcrumb previously drawn at the top of each page's body is gone.
- Collection header is now a read-only summary (library, name, key facts, description, labels) instead of always-editable inline fields.
- Rule wizard no longer asks for an outcome step; the page you opened it from (Rules vs. Cleanup) decides it.
- Preview toolbar: the redundant Plex-home chip is removed, Shuffle hubs moved to the end and matches the pickers' height, and the Provenance (Rule/User) badge uses a quieter fill instead of a border.
- Job Failed events now open the log for the specific run that failed, instead of the job's overall history.
- Bandwidth tile shows total capacity as "of 860 Mbps" on the sub-line instead of a second number crammed into the value line.

### Fixed

- **Custom collection posters set by hand are no longer silently overwritten by the nightly poster job** — only summary edits were protected from this before; poster edits now lock the same way.
- iOS Safari no longer inflates the Table/Grid toggle's text past its button edge, and mobile card-list tables no longer show a white slab behind stacked cards.
- Dashboard panel headers, the Playback History range control, the filter bar, summary tiles and compact tables no longer overflow or misalign on phone-width screens.
- Stats and Jobs previously disagreed on what counts as a "failed job" (failures in the last 24h vs. jobs currently in a failed state); both now use the same definition.
- Failed Jobs (24h) tile now links to a job-failure log that actually matches what it counts, instead of a Jobs list showing "0 of 16".
- Added (7d) tile now links to Media sorted by newest-added, which wasn't previously possible.
- Column configuration (Media, Collections, Streams) no longer hides columns added after a user last saved their layout.
- Registry page rendered its border and warning colors incorrectly in dark mode; both now use the correct theme colors.
- Tables app-wide now draw one consistent left/right border that no longer disappears under row hover/selection highlighting, share one header row height, and use consistent title-column weight (previously inconsistent between Media and other pages).

## [0.18.0] - 2026-08-15

### Added

- The rule wizard now shows an estimated collection count for the current scope, and warns when a rule looks likely to build thousands of collections.

### Changed

- **Grouped rule types that fan out per item (e.g. studios) now default to a minimum group size, so a "Studios" rule no longer tries to build a separate collection for every single-film studio in your library.** Low-cardinality types like genres, decades, and resolutions are unaffected and keep no floor.

### Fixed

- Deleting a collection that Plex had already removed (returning a 404) no longer fails and leaves the stale entry on screen — Tinkerbell now clears it locally and tells you it was already gone.
- Panels on the Stats and Jobs dashboards no longer swap places under your cursor as their contents update (e.g. a stream starting or a job finishing); each panel now keeps a fixed position. Summary tiles also no longer change height as their values load in, so they no longer shift the rest of the page.

## [0.17.2] - 2026-08-15

### Fixed

- The admin and portal servers now return a proper 404 for a missing build asset instead of serving the app shell, so a browser left open across an update shows an "app was updated" message instead of a confusing "failed to fetch" error with a dead retry button.
- List pages (Users, Events, Media, Collections) no longer visibly rearrange themselves as their data finishes loading — the loading skeleton now matches the real table's header, card, and filter bar layout. Loading placeholders also now render correctly in dark mode instead of staying near-white.
- **Random and sequential Plex preroll modes were swapped — a "random" preroll list played every video in order, and "sequential" picked one at random.** This is now corrected; the fix takes effect on each server's next sync, no action needed.
- The sidebar no longer visibly resettles a few hundred milliseconds after page load as navigation counts and badges arrive.
- Table header rows now use the same dividing line as the rows beneath them, instead of a mismatched line that stayed light in dark mode.
- Fixed a bug where a client navigating away mid-request (most noticeably while a collection poster preview was still rendering) could produce a spurious unhandled-rejection error; such disconnects are now handled silently, while genuine failures are logged and reported properly.

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
