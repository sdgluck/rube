# Changelog

All notable changes to Tinkerbell are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Tinkerbell is currently beta software (0.x) — APIs, data shapes, and behaviour may change between releases.

## [Unreleased]

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
