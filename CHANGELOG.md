# Changelog

All notable changes to Tinkerbell are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Tinkerbell is currently beta software (0.x) — APIs, data shapes, and behaviour may change between releases.

## [Unreleased]

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
