/**
 * SQLite-backed key/value config store with a typed Zod schema.
 *
 * The schema, the secret tables and the redaction transforms are pure and stay
 * at module level — they are data, not dependencies, and `ConfigSchema` is
 * `typeof configSchema`, so moving it would break every type derived from it.
 * Everything that reads or writes the database lives inside
 * `createConfigStore`, which the container builds once per process.
 *
 * Usage:
 *   const config = scope.resolve(ConfigStoreToken);
 *   config.setConfig("global_plex_url", "http://localhost:32400");
 *
 * Inside a module that has the store injected, destructuring keeps the old
 * call shape verbatim:
 *
 *   const { getConfig, setConfig } = deps.config;
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { token } from "@tinkerbell/container";
import { DOWNLOAD_CLIENT_KINDS, portalPrerollCardSchema } from "@tinkerbell/contracts";
import { config, type Db } from "@tinkerbell/db";
import type { ChangeRecorder } from "@tinkerbell/ports";
import { createLogger } from "./logger.ts";
import { errorMessage } from "./util.ts";

const timezoneLog = createLogger("timezone");

// Shared with the browser's schedule editor; see contracts' clock.ts.
export { isValidTimezone } from "@tinkerbell/contracts";
import { isValidTimezone } from "@tinkerbell/contracts";

/**
 * Where one service's watchlist adds land.
 *
 * One of these per \*Arr rather than a single shared block, because films and
 * series do not share a root folder or a quality profile on any real install —
 * and a rule that pretends they do is one that puts every series in the movies
 * directory the first time somebody watchlists a show.
 */
const watchlistArrTargetSchema = z.object({
  enabled: z.boolean(),
  /** Absent means the service's default instance, as in `RuleConfig.arr`. */
  instanceId: z.string().optional(),
  /** 0 means "not chosen yet"; the sync refuses to add against it. */
  qualityProfileId: z.number().int(),
  rootFolderPath: z.string(),
  monitor: z.boolean(),
  searchOnAdd: z.boolean(),
});

export type WatchlistArrTarget = z.infer<typeof watchlistArrTargetSchema>;

export const configSchema = z.object({
  global_plex_url: z.string(),
  global_plex_token: z.string(),
  global_plex_libraries: z.array(z.string()),
  /**
   * IANA timezone every cron schedule is evaluated in (e.g. "Europe/London").
   * Unset means "use the container's local time" (`process.env.TZ`, else the
   * host default). Without this, `0 3 * * *` silently follows whatever the
   * container thinks local time is and double-fires or skips on DST changes.
   *
   * Deliberately a plain `z.string()`, validated at the write boundary
   * (`configRouter.save`) rather than here. `configSchema` is used on *read*
   * too — `getConfig` parses the stored value, and `getAllConfig` parses the
   * whole blob — so a `.refine()` would turn one bad row into a throw out of
   * every config read, which is a worse failure than the one it prevents.
   * `schedulerTimezone()` re-checks whatever it finds before use.
   */
  global_timezone: z.string(),
  /**
   * Master switch for per-user personalization. When `enabled`, every Plex
   * item carries the `Tinkerbell` label and every shared user is restricted
   * to `[Tinkerbell, User:<self>]`, which is what makes per-user collections
   * (BYW, the portal) visible only to their owner. `enabling`/`disabling`
   * are transient states while the long-running jobs run.
   */
  global_personalized_sharing: z.object({
    status: z.enum(["disabled", "enabling", "enabled", "disabling"]),
    enabledAt: z.number().optional(),
    lastReconcileAt: z.number().optional(),
  }),
  /**
   * Items per second the last personalization labelling pass actually managed,
   * as `{ itemsPerSecond, items, measuredAt }`.
   *
   * Feeds the enable confirmation's duration estimate. A constant there said
   * "~3m" for a pass that took ~27 — the rate is a property of the user's Plex
   * server and disk, not of this code, so it is measured rather than assumed.
   * Only passes that labelled enough items to time meaningfully write it.
   */
  personalize_label_rate: z.object({
    itemsPerSecond: z.number().positive(),
    items: z.number().int().nonnegative(),
    measuredAt: z.number(),
  }),
  /** Stable X-Plex-Client-Identifier for the Sign-in-with-Plex portal flow. */
  global_plex_client_id: z.string(),

  // ─── Admin authentication ───────────────────────────────────────────────
  /**
   * Master switch for admin auth. Off by default so an upgrade never locks
   * anyone out of a working loopback install; the app offers to turn it on.
   */
  admin_auth_enabled: z.boolean(),
  /**
   * The admin flow's X-Plex-Client-Identifier. Separate from the portal's
   * `global_plex_client_id` on purpose — see `ensureAdminPlexClientId`.
   */
  admin_plex_client_id: z.string(),
  /**
   * The Plex account id of the server owner — the one identity that always
   * gets admin access. Resolved from `global_plex_token` via plex.tv and
   * cached here, because plex.tv being down shouldn't stop you signing in
   * with a cookie you already hold.
   */
  global_plex_owner_id: z.number(),
  /** The owner's Plex username, shown in the UI. Cosmetic. */
  global_plex_owner_username: z.string(),
  /**
   * SHA-256 of the `global_plex_token` the owner id was resolved from. When
   * the token changes the cached owner is stale and gets re-resolved — a
   * rotated token pointing at a different account must not keep admitting
   * the old one.
   */
  global_plex_owner_token_hash: z.string(),
  /**
   * Additional Plex account ids granted admin access. Empty means owner-only,
   * which is the expected configuration; this exists so a second admin doesn't
   * require a schema change later.
   */
  admin_allowed_user_ids: z.array(z.number()),
  /** Public base URL of the user portal, used as the Plex auth forwardUrl. */
  user_app_public_url: z.string(),
  /** Admin-customizable look of the user portal (header + background). */
  portal_branding: z.object({
    title: z.string().optional(),
    icon: z.string().optional(),
    iconColor: z.string().optional(),
    // A URL or a base64 data URL (uploaded image). Capped to keep the config
    // row — and the payload shipped to the browser — to a sane size.
    backgroundImage: z.string().max(8_000_000).optional(),
  }),
  /**
   * Portal components the admin has switched off, by id from
   * `PORTAL_COMPONENTS` (contracts). A hidden list rather than a visible one so
   * a component added later is on by default. Plain strings, not an enum: a
   * build that retires an id must not turn this row into a throw out of every
   * config read — `configRouter.save` rejects unknown ids on the way in.
   */
  portal_components_hidden: z.array(z.string()).max(40),
  /**
   * Movie match: shared users make a room, swipe through a movie library
   * together, and see what everyone liked. Off by default — it is a new thing
   * shared users can do on someone's server, so the server's owner opts in —
   * and turning it on starts the portal if nothing else has (`portalShouldRun`).
   */
  match_enabled: z.boolean(),
  global_anthropic_api_key: z.string(),
  global_llm: z.object({
    provider: z.enum(["anthropic", "openai", "gemini", "ollama", "openai-compatible"]),
    model: z.string(),
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional(),
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
  }),
  /**
   * Monthly cap on LLM tokens (in + out), counted per calendar month in the
   * configured timezone. 0 or unset is no cap. Once reached, AI rules and the
   * other AI features skip as if no provider were configured until the month
   * rolls over; health checks and Test connection still run so the provider
   * can be diagnosed. Usage itself lives in `llm_usage`.
   */
  ai_monthly_token_budget: z.number().int().min(0),
  global_radarr_url: z.string(),
  global_radarr_api_key: z.string(),
  global_sonarr_url: z.string(),
  global_sonarr_api_key: z.string(),
  /**
   * Additional Radarr/Sonarr instances, beyond the pair above.
   *
   * A split 4K instance is the norm in this community — a second Radarr with
   * its own root folder and quality profiles, often a third for anime — and
   * one url/key pair per service could not express it. A cleanup rule could
   * not delete from the right instance, and auto-add could not target one.
   *
   * Additive rather than a migration: the existing keys stay exactly as they
   * are and become the *default* instance of their service. Nothing has to be
   * moved, every rule that names no instance keeps using the pair it always
   * used, and an install that never wants a second instance never sees one.
   */
  global_arr_instances: z.array(
    z.object({
      /** Stable across renames — rules refer to this, not to the name. */
      id: z.string(),
      service: z.enum(["radarr", "sonarr"]),
      /** What it is called in pickers: "4K", "Anime". */
      name: z.string(),
      url: z.string(),
      apiKey: z.string(),
    }),
  ),
  /**
   * SABnzbd, NZBGet, qBittorrent, Transmission and Deluge, for the Downloads
   * page's status and pause controls.
   *
   * Tinkerbell's own connection rather than one borrowed from Radarr or
   * Sonarr: the *Arrs mask every download client credential in their API, so
   * there is nothing to borrow. A list with stable ids, like
   * `global_arr_instances`, because two of the same client — a SABnzbd per
   * *Arr — is ordinary.
   */
  global_download_clients: z.array(
    z.object({
      /** Stable across renames. */
      id: z.string(),
      kind: z.enum(DOWNLOAD_CLIENT_KINDS),
      name: z.string(),
      url: z.string(),
      username: z.string().optional(),
      /** SABnzbd's API key, or the password for everything else. A nested secret. */
      secret: z.string().optional(),
    }),
  ),
  /**
   * Plex Watchlist → Radarr/Sonarr.
   *
   * The *Arr half deliberately reuses the vocabulary of `RuleConfig.arr` —
   * instance, quality profile, root folder, monitor, search — because it is
   * the same act with a different trigger, and two spellings of "where do
   * added films go" is how a server ends up with films in two places.
   *
   * The cap and the dry-run switch sit at the top rather than inside each
   * target, which is where the rule shape puts them. A per-service cap does
   * not compose: "thirty" on Radarr and "thirty" on Sonarr is a run that can
   * add sixty, and the number a person means when they set a limit here is
   * the one for the run. Cleanup learned the same thing one layer down.
   *
   * `removeOnAvailable` is the only setting here that writes to the user's own
   * Plex account, and it defaults off for that reason alone.
   */
  watchlist_sync: z.object({
    enabled: z.boolean(),
    radarr: watchlistArrTargetSchema,
    sonarr: watchlistArrTargetSchema,
    removeOnAvailable: z.boolean(),
    maxAddsPerRun: z.number().int().min(1).max(500),
    dryRun: z.boolean(),
  }),
  global_seerr_url: z.string(),
  global_seerr_api_key: z.string(),
  global_omdb_api_key: z.string(),
  global_mdblist_api_key: z.string(),
  /**
   * Trakt client id. Enough on its own to read public lists, which is what
   * the `list_source` rule uses it for — a personal watchlist or collection
   * would need the OAuth device flow, which isn't implemented.
   */
  global_trakt_client_id: z.string(),
  global_tmdb_api_key: z.string(),
  global_tmdb_region: z.string(),
  global_pushover_api_key: z.string(),
  global_pushover_user_key: z.string(),
  global_pushover_events: z.array(z.string()),
  global_pushover_jobs: z.array(z.string()),
  global_pushover_health_targets: z.array(z.string()),
  global_discord_webhook_url: z.string(),
  global_discord_events: z.array(z.string()),
  global_discord_jobs: z.array(z.string()),
  global_discord_health_targets: z.array(z.string()),
  global_gotify_url: z.string(),
  global_gotify_token: z.string(),
  global_gotify_events: z.array(z.string()),
  global_gotify_jobs: z.array(z.string()),
  global_gotify_health_targets: z.array(z.string()),
  global_lunasea_webhook_url: z.string(),
  global_lunasea_events: z.array(z.string()),
  global_lunasea_jobs: z.array(z.string()),
  global_lunasea_health_targets: z.array(z.string()),
  global_pushbullet_token: z.string(),
  global_pushbullet_events: z.array(z.string()),
  global_pushbullet_jobs: z.array(z.string()),
  global_pushbullet_health_targets: z.array(z.string()),
  global_slack_webhook_url: z.string(),
  global_slack_events: z.array(z.string()),
  global_slack_jobs: z.array(z.string()),
  global_slack_health_targets: z.array(z.string()),
  global_telegram_bot_token: z.string(),
  global_telegram_chat_id: z.string(),
  global_telegram_send_silently: z.boolean(),
  global_telegram_events: z.array(z.string()),
  global_telegram_jobs: z.array(z.string()),
  global_telegram_health_targets: z.array(z.string()),
  global_webhook_url: z.string(),
  global_webhook_events: z.array(z.string()),
  global_webhook_jobs: z.array(z.string()),
  global_webhook_health_targets: z.array(z.string()),
  /**
   * Outbound mail. The ninth notification service, and the only one that can
   * reach somebody who doesn't use the admin UI — which is the whole point of
   * a digest.
   *
   * `to` is the admin's own address, used for events and the server-wide
   * digest. Per-user digests are addressed to the address that user typed into
   * the portal and are never sent to anything else.
   *
   * `password` is a nested secret, redacted in `redactSecrets` alongside
   * `global_llm.apiKey`.
   */
  global_smtp: z.object({
    host: z.string(),
    /**
     * 0 means "not set". Deliberately not `.positive()`: the Settings form
     * saves every field of this object at once, so a blank port would fail
     * validation and reject the whole save — including the event selection
     * the user was actually editing. `smtpConfigured()` treats 0 as absent.
     */
    port: z.number().int().min(0),
    /** Implicit TLS (port 465). STARTTLS on 587 is negotiated with this off. */
    secure: z.boolean(),
    user: z.string().optional(),
    password: z.string().optional(),
    from: z.string(),
    to: z.string().optional(),
  }),
  global_smtp_events: z.array(z.string()),
  global_smtp_jobs: z.array(z.string()),
  global_smtp_health_targets: z.array(z.string()),
  /**
   * Fraction of an item's runtime past which a play counts as "watched".
   *
   * This is the definition every downstream consumer inherits — watched-by-all
   * filters, cleanup rules, digests — so it is deliberately one setting rather
   * than a per-feature threshold. 0.85 matches Tautulli's default and leaves
   * room for credits.
   */
  playback_completion_threshold: z.number().min(0.5).max(1),
  /** Days of raw session rows to keep. 0 = keep forever. `watch_state` is never pruned. */
  playback_retention_days: z.number().int().min(0),
  /**
   * Hold heavy scheduled jobs back while somebody is watching something.
   *
   * Poster rendering, overlay burn-in and preroll transcodes are CPU and disk
   * against the same box serving the stream, and they are exactly the jobs
   * that run at the hour people are actually watching. Off by default: it
   * delays work, and a server nobody streams from should not inherit a
   * behaviour designed for one that is busy.
   *
   * Only ever applied to *scheduled* starts. A person pressing "Run now" has
   * asked for it now, and silently deferring that is how a button comes to
   * look broken.
   */
  jobs_defer_while_streaming: z.object({
    enabled: z.boolean(),
    /**
     * Give up waiting after this long and run anyway. Without a ceiling a
     * household that streams every evening would push the nightly jobs into
     * never running at all.
     */
    maxWaitMinutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
    /**
     * Transcodes only, rather than any playback at all. A direct play is
     * mostly disk and network; a transcode is the CPU these jobs want.
     */
    transcodesOnly: z.boolean(),
  }),
  /**
   * Confine heavy scheduled jobs to a window of the day.
   *
   * Separate from each job's own cron: a job can be scheduled hourly and still
   * be told never to start work between 6pm and midnight. Times are `HH:MM` in
   * the scheduler's timezone, and a window whose end precedes its start spans
   * midnight — which is the common case for a maintenance window.
   */
  jobs_maintenance_window: z.object({
    enabled: z.boolean(),
    from: z.string(),
    to: z.string(),
  }),
  /**
   * Hours during which nothing is sent to any notification channel.
   *
   * The events still happen and are still recorded — this suppresses delivery
   * only, so the activity feed in the morning is complete. Evaluated in the
   * scheduler's timezone, and an end before the start spans midnight, which is
   * what an overnight quiet period always means.
   *
   * `allowUrgent` lets `plex.unreachable` through regardless. A server that
   * has been down since 2am is the one thing worth waking up for, and without
   * an exemption the honest choice is between being paged about a flapping
   * *Arr and hearing nothing at all.
   */
  notifications_quiet_hours: z.object({
    enabled: z.boolean(),
    from: z.string(),
    to: z.string(),
    allowUrgent: z.boolean(),
  }),
  /**
   * How many consecutive failed checks a service must record before
   * `health.failed` is emitted.
   *
   * 1 preserves the original behaviour and is the default. Higher values are
   * for the services that flap: an *Arr that refuses one request in fifty
   * produced a failure and a recovery every hour, which trains people to
   * ignore the channel those land in.
   *
   * The event still fires on the transition only — raising this delays the
   * announcement, it does not repeat it.
   */
  health_failure_threshold: z.number().int().min(1).max(20),
  /**
   * Per-service mutes, as `service -> epoch ms until which it stays quiet`.
   *
   * For the service you already know is broken and are in the middle of
   * fixing. Expiry is a timestamp rather than a flag so a mute cannot be left
   * on for ever by accident — which is the failure mode that makes people
   * distrust the whole health feature.
   */
  health_mutes: z.record(z.string(), z.number()),
  /**
   * First-run setup: the user's position in the flow, and the decisions they
   * have made about it. Deliberately *not* a per-step done flag.
   *
   * Whether a step is finished is derived from the thing the step was asking
   * for — `HEALTH_SERVICES[].configuredFn` for an integration, the rule count
   * for rules — because a recorded boolean survives the state that earned it.
   * Marking Plex done and then clearing the token would otherwise leave setup
   * claiming to be complete over an install that cannot reach a server.
   *
   * `acknowledged` is the exception, and only covers optional steps: "I don't
   * want notifications" is a real answer with nothing in config to show for
   * it. `domains/onboarding` refuses to acknowledge a step whose
   * `acknowledgeable` is false, so this can never fake the Plex connection.
   */
  onboarding_state: z.object({
    startedAt: z.number().optional(),
    /** Where "Resume" reopens the wizard. Ignored once that step is complete. */
    lastStepId: z.string().optional(),
    /** Optional steps the user explicitly moved past. */
    acknowledged: z.array(z.string()).default([]),
    /** They chose the dashboard over the wizard. Stops the first-run redirect. */
    skipped: z.boolean().optional(),
    /** The progress banner was dismissed for good. Setup itself carries on. */
    dismissedAt: z.number().optional(),
    completedAt: z.number().optional(),
  }),
  /**
   * Whether the server owner counts towards "watched by everyone".
   *
   * Off by default: the owner is usually the person curating the library
   * rather than watching it end to end, so including them makes
   * `tb.watchedByAll` mean "and the admin got round to it too" — which on a
   * cleanup rule is the difference between deleting a finished show and never
   * deleting anything.
   */
  watch_state_all_users_include_owner: z.boolean(),
  /**
   * Master switch for every destructive cleanup action, across every rule.
   *
   * Default false, and checked at the moment of action rather than at save
   * time, so a user who panics has one switch to flip instead of N rules to
   * find and disable. Non-destructive modes (label, collection-only) are not
   * gated on it — they are how someone sensibly tries the feature out.
   */
  cleanup_enabled: z.boolean(),
  /**
   * Ceiling on destructive actions across *all* cleanup rules, over a rolling
   * 24 hours. Per-rule caps don't compose: five rules each staying under their
   * own limit of 30 can still empty a library overnight.
   *
   * Per day rather than the per-run it started as, because "per run" only ever
   * bounded a single batch — an ad-hoc rule run took a fresh full budget, and
   * cleanup now has its own job as well. Spend is counted from the candidate
   * ledger, so it holds however the work was started.
   */
  cleanup_max_deletes_per_day: z.number().int().positive(),
  /** @deprecated Read once at startup to seed `cleanup_max_deletes_per_day`. */
  cleanup_max_deletes_per_run: z.number().int().positive(),
  /**
   * Master switch for rule-driven metadata writes, across every rule.
   *
   * Default false, and checked at the moment of writing rather than at save
   * time — the same shape as `cleanup_enabled`, for the same reason: this
   * writes to somebody's Plex server, over data they curated by hand, and a
   * user who panics wants one switch rather than N rules to find and disable.
   *
   * Manual edits from the Media page are deliberately *not* gated on it. A
   * person editing one item is watching the result; the switch exists for the
   * scheduled runs that nobody is watching.
   */
  metadata_writes_enabled: z.boolean(),
  /**
   * Ceiling on field writes across all metadata rules, over a rolling 24
   * hours. Per-rule caps don't compose — five rules each under their own limit
   * of 200 can still rewrite a library overnight — so this one is global and
   * counted from the ledger, which holds however the work was started.
   */
  metadata_max_writes_per_day: z.number().int().positive(),
  /** How long a metadata batch stays undoable. Pruned by `purge-runs`. */
  metadata_undo_retention_days: z.number().int().positive(),
  /**
   * Transient slot the Undo button writes right before starting the
   * `metadata-undo` command, read at run start and cleared on completion.
   *
   * The same shape as `migration_pending_plan` and for the same reason: the
   * command runs in a Sidequest worker thread, and a config key is the
   * plumbing that already exists to get a parameter there. A batch can be
   * thousands of Plex writes, so it cannot be a request.
   */
  metadata_undo_pending_batch: z.string(),
  media_columns: z.array(z.object({ id: z.string(), visible: z.boolean() })),
  collections_columns: z.array(z.object({ id: z.string(), visible: z.boolean() })),
  stats_summary_tiles: z.array(z.string()).max(10),
  stats_panel_order: z.array(z.string()).max(20),
  /**
   * Stats panels the user has switched off.
   *
   * Stored as the hidden set rather than the visible one so that a panel added
   * in a later release is shown by default — the same reasoning as
   * `usePanelOrder`'s handling of unknown ids, and the opposite of
   * `media_columns`, where an explicit per-column record is the point. A saved
   * "visible" list would freeze every install's dashboard at the panels that
   * existed the day they last opened the picker.
   */
  stats_panels_hidden: z.array(z.string()).max(30),
  /** Stats panels rolled up to their header. Collapsed panels are not rendered at all, so their queries don't run. */
  stats_panels_collapsed: z.array(z.string()).max(30),
  /** Visible columns of the Active Streams panel, in display order. */
  stats_streams_columns: z.array(z.string()).max(20),
  jobs_summary_tiles: z.array(z.string()).max(6),
  jobs_panel_order: z.array(z.string()).max(20),
  /**
   * Menu items the admin has switched off.
   *
   * The hidden set rather than the visible one, so a page added in a later
   * release appears on its own — the same reasoning as `stats_panels_hidden`.
   * A saved "visible" list would freeze every install's menu at the pages that
   * existed the day they last edited it, and the failure is silent: a feature
   * ships and nobody who upgraded ever finds it.
   *
   * Stored as route paths (`/media`), which is what a nav item is identified by
   * everywhere else. `/settings` is refused when the menu is resolved rather
   * than on write, so a hand-edited row can't produce a menu with no way back
   * to the settings that would fix it — see `applyNavPrefs` in `nav.ts`.
   *
   * Global rather than per-admin because this app has no per-admin preference
   * store: `ui_theme` and every `stats_*` key are global for the same reason.
   * If `admin_allowed_user_ids` ever grows past one person, these four keys are
   * the first thing that wants to be per-user.
   */
  nav_items_hidden: z.array(z.string()).max(40),
  /**
   * Menu items in the order they render, as one flat list across every section.
   *
   * Flat because an item's section is fixed by `NAV_SECTIONS` — the menu editor
   * only reorders within a section, so a per-section map would store the same
   * information behind a second identifier to keep in sync. A saved position
   * that would imply a cross-section move is simply inert.
   */
  nav_item_order: z.array(z.string()).max(60),
  /**
   * Menu sections in the order they render, by section id.
   *
   * Ids, not labels: a label is a display string, and renaming "Managers" would
   * otherwise reset every install's section order without anyone touching it.
   */
  nav_section_order: z.array(z.string()).max(20),
  /**
   * Routes occupying the mobile tab bar, in order. "More" is not listed — it is
   * the bar's escape hatch and is always last.
   *
   * The one nav key that is a positive pick rather than a difference from the
   * default: a tab bar has a fixed number of slots, so "a route added later
   * should appear here" is not something anyone wants of it. Empty means the
   * defaults, which is also what Reset writes — every one of these four keys
   * treats `[]` and absent identically, so resetting is one write rather than a
   * delete path `configRouter` does not have.
   */
  nav_bottom_tabs: z.array(z.string()).max(4),
  /**
   * Which colour scheme the admin UI draws in. `system` follows
   * `prefers-color-scheme`; the other two pin it.
   *
   * Stored server-side, alongside the other UI persistence keys, so the choice
   * follows the admin between browsers rather than being relearned on every
   * machine. The browser also keeps a localStorage mirror, which is what the
   * boot script in `index.html` reads — the theme has to be on `<html>` before
   * the first paint, and the config round trip lands long after it.
   */
  ui_theme: z.enum(["system", "light", "dark"]),
  /**
   * The admin UI's interface size, as a multiplier of the designed size — one
   * of `UI_SCALES` in contracts. Applied as the root font size, which every
   * length in the stylesheets is a rem of.
   *
   * Same storage story as `ui_theme`: server-side so it follows the admin, a
   * localStorage mirror for the boot script. A bare number here rather than
   * the list, because this schema also runs on read; `configRouter.save`
   * refuses anything off the list.
   */
  ui_scale: z.number(),
  /**
   * Overseerr request ids already seen as available, for the
   * `request-fulfilled` rule trigger.
   *
   * A watermark on `updatedAt` would be the obvious design and the wrong one:
   * Overseerr does not expose one on the request list, and a request can be
   * marked available, reverted and marked again. Ids are what it does have.
   *
   * Capped when written — this is a "have I told anyone about this yet" set,
   * not a history, and an install with ten thousand fulfilled requests does
   * not need to remember the first nine thousand.
   */
  seerr_seen_available: z.array(z.number().int()),
  /**
   * Whether the Overseerr poller has ever completed a poll.
   *
   * Separate from `seerr_seen_available` because an empty set is not evidence of
   * a first run: an install with no fulfilled requests yet stores nothing, so
   * "nothing stored" stayed true until the *first genuine* fulfilment — which
   * was then adopted as history and fired no rules at all, which is the one
   * event the trigger exists for.
   */
  seerr_polled: z.boolean(),
  /**
   * Where Plex sees Tinkerbell's prerolls directory. Tinkerbell writes files
   * under `PREROLLS_DIR`; Plex resolves `CinemaTrailersPrerollID` against its
   * own filesystem, so the same directory usually has a different mount point
   * in each container. This is that prefix — the Sonarr/Radarr "remote path
   * mapping" idea, reduced to the single directory we care about.
   */
  prerolls_plex_path: z.string(),
  /**
   * How Plex plays the pool. `random` joins the paths with `;` (Plex picks
   * one per playback); `sequential` joins with `,` (Plex plays them in order).
   * The separator is Plex's convention, not ours.
   */
  prerolls_mode: z.enum(["random", "sequential"]),
  /** Downscale ceiling for the transcoder. */
  prerolls_max_height: z.number().int().positive(),
  /**
   * Text and colours of the generated "customise your Plex" preroll, which
   * points viewers at the portal. Whether the card is *in the pool* is not
   * stored here — that is the existence of a `kind = 'portal'` prerolls row,
   * so deleting the card from the Prerolls page can't leave a setting that
   * claims otherwise. Strict validation is `portalPrerollCardInput`, on write.
   */
  portal_preroll: portalPrerollCardSchema,
  /**
   * Master switch for the `collection-art` job. Off stops every upload at
   * once — one switch to flip rather than N rules to find and edit, the same
   * shape as `cleanup_enabled` and for the same reason: this writes to
   * somebody's Plex server.
   *
   * Default on, because the per-rule `presentation.poster` already defaults to
   * `none`. Nothing is uploaded until a rule opts in, so a master switch that
   * defaulted off would just be a second thing to remember to turn on.
   */
  collection_art_enabled: z.boolean(),
  /** Poster template the wizard preselects for a rule turning artwork on. */
  collection_art_default_template: z.enum(["gradient", "mosaic", "spotlight"]),
  /** Accent applied when a rule doesn't set one. Empty means derive per collection. */
  collection_art_default_accent: z.string(),
  /**
   * A Kometa-style asset directory on the server's filesystem, read for
   * collection artwork when a rule's poster source is `asset`. Empty disables
   * the source entirely — nothing reads the disk until an admin points at it.
   */
  global_asset_directory: z.string(),
  posters_kometa_enabled: z.boolean(),
  posters_kometa_person_style: z.enum(["bw", "rainier", "signature", "diiivoy", "diiivoycolor"]),
  /**
   * Per-provider scan results, keyed by provider id (e.g. "kometa"). Each
   * provider's scan job writes its own slot; the migration domain aggregates
   * across all of them for the banner / Settings → Migrate UI.
   */
  migration_state: z.record(
    z.string(),
    z.object({
      count: z.number(),
      scannedAt: z.number(),
      bySection: z.array(z.object({ sectionId: z.string(), sectionTitle: z.string(), count: z.number() })),
    }),
  ),
  migration_dismissed_at: z.record(z.string(), z.number()),
  migration_completed_at: z.record(z.string(), z.number()),
  /**
   * What the last migration actually created, and what each rule was meant to
   * replace.
   *
   * Written by the migrate-collections job, and the only thing that makes
   * verification possible: the plan knows a rule replaces collection 77001,
   * but once the job has run that link exists nowhere — the rule doesn't
   * record where it came from, and the collection doesn't record what took it
   * over. Without this, "did the migration actually reproduce my collections?"
   * can only be answered by eye.
   */
  migration_last_result: z.object({
    providerId: z.string(),
    completedAt: z.number(),
    entries: z.array(
      z.object({
        ruleId: z.string(),
        ruleName: z.string(),
        /** Plex collections this rule was migrated from. Often empty. */
        replacesRatingKeys: z.array(z.string()),
      }),
    ),
  }),
  /**
   * Transient slot the Settings → Migrate page writes into right before
   * kicking off the migrate-collections command. The command reads it at run
   * start and clears it on success. Held in config so the Sidequest worker
   * thread doesn't need any additional plumbing to receive the user's
   * selection. Only one pending plan exists at a time across all providers
   * — `providerId` identifies which provider the run belongs to.
   */
  migration_pending_plan: z.object({
    providerId: z.string(),
    items: z.array(
      z.object({
        ruleType: z.string(),
        ruleName: z.string(),
        sectionId: z.string(),
        ruleConfig: z.record(z.string(), z.unknown()),
        /**
         * Omitted means disabled — the behaviour every migration had before
         * the YAML importer, and still the right default for anything the
         * mapping wasn't fully confident about.
         */
        enabled: z.boolean().optional(),
        replacesRatingKeys: z.array(z.string()),
      }),
    ),
    deleteOriginals: z.boolean(),
    /**
     * Overlay badge layouts to apply, per Plex section.
     *
     * Rides on the plan rather than being applied by the router because
     * applying them is a write to somebody's library and belongs in the job
     * that owns every other write this migration makes — so it succeeds or
     * fails alongside the rules, and shows up in the same run log.
     */
    overlays: z
      .array(
        z.object({
          sectionId: z.string(),
          sectionTitle: z.string(),
          configs: z.array(
            z.object({
              position: z.string(),
              overlayType: z.string(),
              order: z.number().optional(),
              style: z.record(z.string(), z.unknown()).nullish(),
              rule: z.record(z.string(), z.unknown()).nullish(),
            }),
          ),
        }),
      )
      .optional(),
    /** Per-item metadata edits to store, per Plex section. */
    metadataOverrides: z
      .array(
        z.object({
          sectionId: z.string(),
          sectionTitle: z.string(),
          overrides: z.array(
            z.object({
              match: z.object({
                title: z.string(),
                year: z.number().optional(),
                imdb: z.string().optional(),
                tmdb: z.number().optional(),
              }),
              fields: z.record(z.string(), z.string()),
              tags: z.record(z.string(), z.array(z.string())),
            }),
          ),
        }),
      )
      .optional(),
    submittedAt: z.number(),
  }),
  /**
   * Last successful fetch of the public rule registry, cached so browsing the
   * catalogue doesn't hit tinkerbell.dev on every render. Stored loosely
   * (`z.unknown()` for the payload) because the authority on the registry's
   * shape is `registryIndexSchema` in `@tinkerbell/contracts`, which
   * `domains/registry` re-validates on read — duplicating it here would mean
   * two schemas to keep in step, and a format bump would fail as an opaque
   * config-parse error rather than the actionable "update Tinkerbell" message.
   * `url` is recorded so a changed `REGISTRY_URL` invalidates the cache.
   */
  registry_cache: z.object({
    fetchedAt: z.number(),
    url: z.string(),
    index: z.unknown(),
  }),
  /**
   * Rule id → the pack version we last announced an update for.
   *
   * `registry.update_available` is a transition event, and the check that
   * produces it runs on a schedule — without a record of what has already been
   * said, every daily run re-announces the same pending update until the user
   * applies it. Entries for rules that no longer have an update are dropped,
   * so a re-published version announces again.
   */
  registry_announced_updates: z.record(z.string(), z.number()),
  /**
   * Legacy single-provider slots, kept readable for one release so a
   * one-shot migration in `domains/migration` can fold them into the
   * provider-keyed slots above. Safe to remove once shipped users have
   * upgraded.
   */
  migration_kometa_state: z.object({
    count: z.number(),
    scannedAt: z.number(),
    bySection: z.array(z.object({ sectionId: z.string(), sectionTitle: z.string(), count: z.number() })),
  }),
  migration_kometa_dismissed_at: z.number(),
  migration_kometa_completed_at: z.number(),

  // ─── Backups ─────────────────────────────────────────────────────────────
  /**
   * Whether the nightly database backup runs.
   *
   * Defaults **on**, which is deliberate and the whole point: a backup nobody
   * enabled is a backup nobody has. Every install that upgrades into this
   * feature starts keeping copies without being asked, and the cost is a few
   * megabytes of gzipped SQLite a night.
   */
  backup_enabled: z.boolean(),
  /**
   * Where backups are written. Defaults to `<DATA_DIR>/backups`.
   *
   * `DATA_DIR` is the volume people already mount for `tinkerbell.db`, so the
   * default lands on durable storage. A path *outside* it inside a container
   * is on the ephemeral layer and vanishes with the container — which is
   * theatre, not a backup — so the Settings page says so next to this field.
   */
  backup_dir: z.string(),
  /**
   * @deprecated Never read: backups run on the `backup` job's own schedule,
   * which Settings → Backup now edits. Kept so an old row still parses; boot
   * carries a customised value over to the job once and deletes the key.
   */
  backup_schedule: z.string(),
  /** How many to keep. The oldest beyond this are deleted after a good run. */
  backup_keep_count: z.number().int().min(1).max(365),
  migration_kometa_pending_plan: z.object({
    items: z.array(
      z.object({
        ruleType: z.string(),
        ruleName: z.string(),
        sectionId: z.string(),
        ruleConfig: z.record(z.string(), z.unknown()),
        replacesRatingKeys: z.array(z.string()),
      }),
    ),
    deleteOriginals: z.boolean(),
    submittedAt: z.number(),
  }),
});

export type ConfigSchema = typeof configSchema;
export type ConfigKey = keyof z.infer<ConfigSchema>;
export type ConfigValue<K extends ConfigKey> = z.infer<ConfigSchema>[K];

/**
 * Sent in place of a stored secret when the value is shipped to the browser.
 * `setConfig` (and the config.save tRPC mutation) treat this sentinel as
 * "keep the existing value" so the form can round-trip without erasing.
 *
 * The sentinel is freshly randomised per process so a user can't deliberately
 * (or accidentally) type it into a secret field and have the save endpoint
 * silently skip the update.
 */
export const REDACTED_SECRET = `__redacted__:${randomUUID()}`;

/**
 * Top-level config keys whose values must never be sent to the browser.
 * Webhook URLs are included because they typically contain bearer tokens.
 * Secrets that live *inside* a structured value are listed in
 * `NESTED_SECRETS` instead.
 */
export const SECRET_KEYS = new Set<ConfigKey>([
  "global_plex_token",
  "global_anthropic_api_key",
  "global_radarr_api_key",
  "global_sonarr_api_key",
  "global_seerr_api_key",
  "global_omdb_api_key",
  "global_mdblist_api_key",
  "global_trakt_client_id",
  "global_tmdb_api_key",
  "global_pushover_api_key",
  "global_pushover_user_key",
  "global_gotify_token",
  "global_pushbullet_token",
  "global_telegram_bot_token",
  "global_discord_webhook_url",
  "global_lunasea_webhook_url",
  "global_slack_webhook_url",
  "global_webhook_url",
]);

/**
 * Secrets that live inside a structured value, where `SECRET_KEYS` can't reach
 * them. Declared as a table rather than written out at each site because the
 * two that were: `global_arr_instances[].apiKey` arrived with multi-instance
 * \*Arr support and matched neither hand-written case, so every additional
 * Radarr/Sonarr key went to the browser in full.
 *
 * `each` marks a list — the secret is a field of every element, and elements
 * are matched back up by `id` when a save restores them.
 */
export const NESTED_SECRETS: ReadonlyArray<{ key: ConfigKey; field: string; each?: boolean }> = [
  { key: "global_llm", field: "apiKey" },
  { key: "global_smtp", field: "password" },
  { key: "global_arr_instances", field: "apiKey", each: true },
  { key: "global_download_clients", field: "secret", each: true },
];

/** Keys carrying a nested secret, for callers that only need the question answered. */
export const NESTED_SECRET_KEYS = new Set<ConfigKey>(NESTED_SECRETS.map((n) => n.key));

/**
 * Config keys the change log ignores.
 *
 * `setConfig` is the chokepoint for two quite different things that share one
 * signature: settings a person chose, and state the app parks in the config
 * table because it needed somewhere to put it. Logging both would bury the
 * first under the second — `registry_cache` alone rewrites daily, and
 * `stats_panel_order` rewrites on every drag of a dashboard tile.
 *
 * Three groups, and the reason each is here matters more than the list:
 *
 *  - **Job state.** Written by a scheduled job, never by a person. Its history
 *    is the job's run history, which already exists.
 *  - **View state.** Column widths, panel order, theme. Real preferences, but
 *    "restore the version of my dashboard layout from Tuesday" is not a
 *    question anyone has, and the write rate is per-interaction.
 *  - **Credential artefacts.** `global_plex_owner_token_hash` is a hash, not a
 *    secret in `SECRET_KEYS`, so redaction would not catch it — and a history
 *    of hashes is an offline-attack surface for no benefit. The auth *policy*
 *    keys (`admin_auth_enabled`, `admin_allowed_user_ids`) are deliberately
 *    NOT here: who may sign in is exactly the change worth being able to see.
 *
 * Typed as `ConfigKey` so a key renamed in `configSchema` fails the build here
 * rather than silently starting to log, and adding a new transient key is a
 * deliberate line in this list rather than an accident of where it is written.
 */
export const UNLOGGED_CONFIG_KEYS = new Set<ConfigKey>([
  // Job state
  "global_personalized_sharing",
  "personalize_label_rate",
  "metadata_undo_pending_batch",
  "migration_state",
  "migration_last_result",
  "migration_pending_plan",
  "migration_dismissed_at",
  "migration_completed_at",
  "migration_kometa_state",
  "migration_kometa_pending_plan",
  "migration_kometa_dismissed_at",
  "migration_kometa_completed_at",
  "registry_cache",
  "registry_announced_updates",
  "seerr_seen_available",
  "seerr_polled",
  "onboarding_state",
  // View state
  "media_columns",
  "collections_columns",
  "stats_summary_tiles",
  "stats_panel_order",
  "stats_panels_hidden",
  "stats_panels_collapsed",
  "stats_streams_columns",
  "jobs_summary_tiles",
  "jobs_panel_order",
  "nav_items_hidden",
  "nav_item_order",
  "nav_section_order",
  "nav_bottom_tabs",
  "ui_theme",
  "ui_scale",
  // Credential artefacts
  "global_plex_owner_token_hash",
  "global_plex_client_id",
  "admin_plex_client_id",
]);

type Unknowns = Record<string, unknown>;

function redactField(entry: unknown, field: string): unknown {
  if (!entry || typeof entry !== "object") return entry;
  const value = (entry as Unknowns)[field];
  if (typeof value !== "string" || value === "") return entry;
  return { ...(entry as Unknowns), [field]: REDACTED_SECRET };
}

function restoreField(next: unknown, stored: unknown, field: string): unknown {
  if (!next || typeof next !== "object") return next;
  if ((next as Unknowns)[field] !== REDACTED_SECRET) return next;
  const kept = stored && typeof stored === "object" ? (stored as Unknowns)[field] : undefined;
  return { ...(next as Unknowns), [field]: kept };
}

export type PersonalizedSharingStatus = "disabled" | "enabling" | "enabled" | "disabling";

/**
 * Pure transform: take a config blob and replace every secret value with
 * `REDACTED_SECRET`. Extracted from `getAllConfigForClient` so it can be
 * exercised by unit tests without standing up a SQLite instance.
 */
export function redactSecrets(input: Partial<z.infer<ConfigSchema>>): Partial<z.infer<ConfigSchema>> {
  const all = { ...input } as Unknowns;
  for (const key of SECRET_KEYS) {
    if (typeof all[key] === "string" && all[key] !== "") all[key] = REDACTED_SECRET;
  }
  for (const { key, field, each } of NESTED_SECRETS) {
    const value = all[key];
    if (value === undefined || value === null) continue;
    if (each) {
      if (Array.isArray(value)) all[key] = value.map((entry) => redactField(entry, field));
    } else {
      all[key] = redactField(value, field);
    }
  }
  return all as Partial<z.infer<ConfigSchema>>;
}

/**
 * Redact one key's value, rather than a whole blob.
 *
 * `redactSecrets` above takes the config as a map because that is the shape
 * `getAllConfigForClient` has. The change log records one key at a time and
 * would otherwise have to synthesise a one-entry map and unpack the result,
 * which reads as a trick rather than as "this value is a secret".
 *
 * Both routes are covered here — a top-level secret and a secret nested inside
 * a structured value — because the second is where this has gone wrong before:
 * `global_arr_instances[].apiKey` matched neither hand-written case and every
 * extra \*Arr key went to the browser in full.
 */
export function redactConfigValue(key: ConfigKey, value: unknown): unknown {
  if (SECRET_KEYS.has(key)) {
    return typeof value === "string" && value !== "" ? REDACTED_SECRET : value;
  }
  const nested = NESTED_SECRETS.filter((n) => n.key === key);
  if (nested.length === 0) return value;
  let out = value;
  for (const { field, each } of nested) {
    if (out === undefined || out === null) continue;
    out = each ? (Array.isArray(out) ? out.map((entry) => redactField(entry, field)) : out) : redactField(out, field);
  }
  return out;
}

export interface ConfigStoreDeps {
  db: Db;
  /**
   * Where a settings change is recorded. Required rather than optional: an
   * omitted recorder means a config store that silently keeps no history, and
   * this whole package exists downstream of the lesson that a no-op default is
   * indistinguishable from working wiring.
   */
  recordChange: ChangeRecorder;
}

export function createConfigStore(deps: ConfigStoreDeps) {
  const { db, recordChange } = deps;

  /**
   * The timezone this install lives in: `global_timezone`, else `TZ`, else the
   * process clock.
   *
   * Lives here rather than beside the scheduler because "what day is it" and
   * "what time is it" are not only the scheduler's questions. Cron was
   * zone-aware from the start, while the maintenance window read `getHours()`,
   * seasonal rule windows read `getMonth()/getDate()` and the stats day
   * boundaries read `setHours(0,0,0,0)` — so a UTC container configured for
   * `America/Los_Angeles` enforced its quiet hours eight hours out and rolled
   * "today" over at 17:00 local.
   *
   * Both sources are validated rather than trusted. `global_timezone` is
   * schema-checked on save, but a row written by an older build (or by hand)
   * bypasses that, and `TZ` never goes through the schema at all — setting it in
   * a compose file is the first thing a self-hoster does. A bad value propagated
   * into every `new Cron` throws during `initJobs`, which the server turns into
   * `process.exit(1)`: a crash-loop with no UI left to fix it from.
   */
  function configuredTimezone(): string | undefined {
    let configured: string | undefined;
    try {
      configured = getConfig("global_timezone")?.trim();
    } catch (err) {
      // `getConfig` parses the stored value against the schema, so a corrupt row
      // throws here. Callers include `initJobs`, where an exception escaping is a
      // boot failure — precisely what this guards against.
      timezoneLog.error("could not read the configured timezone", { err: errorMessage(err) });
    }
    if (configured) {
      if (isValidTimezone(configured)) return configured;
      timezoneLog.error("ignoring invalid configured timezone", { timezone: configured });
    }

    const env = process.env.TZ?.trim();
    if (env) {
      if (isValidTimezone(env)) return env;
      timezoneLog.error("ignoring invalid TZ environment variable", { TZ: env });
    }

    // undefined = follow the process's own local time, which is the behaviour we
    // had before the setting existed. Degraded, but running.
    return undefined;
  }

  function getConfig<K extends ConfigKey>(key: K): ConfigValue<K> | undefined {
    const row = db.select({ value: config.value }).from(config).where(eq(config.key, key)).get();
    if (row?.value === undefined || row.value === null) return undefined;
    return configSchema.shape[key].parse(row.value) as ConfigValue<K>;
  }

  /**
   * `record: false` leaves the change log to the caller, for a save that writes
   * config alongside other things and logs the whole edit as one entry — the
   * schedule page's timezone and window are part of "changed the schedule",
   * not three separate settings edits beside it.
   */
  function setConfig<K extends ConfigKey>(key: K, value: ConfigValue<K>, opts: { record?: boolean } = {}): void {
    // Validate on the way in, not just on the way out.
    //
    // `getConfig` parses, `setConfig` used not to — so a value the schema
    // rejects was written happily and then threw on every subsequent *read*.
    // Worse, `setConfig` itself reads (below, for the change log), so one bad
    // write poisoned the key permanently: every later attempt to correct it
    // threw before it could store anything, and the only way out was editing
    // the database by hand.
    //
    // Failing here instead points at the caller that passed the bad value,
    // while the stored configuration is still good.
    configSchema.shape[key].parse(value);

    // Read before write, and only when the key is actually logged — an
    // unconditional read would double every settings write's query count to
    // populate a column that `UNLOGGED_CONFIG_KEYS` then throws away.
    const logged = opts.record !== false && !UNLOGGED_CONFIG_KEYS.has(key);
    const before = logged ? getConfig(key) : undefined;

    db.insert(config).values({ key, value }).onConflictDoUpdate({ target: config.key, set: { value } }).run();

    if (!logged) return;
    recordChange({
      entity: "config",
      entityId: key,
      action: before === undefined ? "create" : "update",
      before: before === undefined ? undefined : redactConfigValue(key, before),
      after: redactConfigValue(key, value),
    });
  }

  function deleteConfig(key: ConfigKey): void {
    const logged = !UNLOGGED_CONFIG_KEYS.has(key);
    const before = logged ? getConfig(key) : undefined;
    db.delete(config).where(eq(config.key, key)).run();
    if (!logged || before === undefined) return;
    recordChange({
      entity: "config",
      entityId: key,
      action: "delete",
      before: redactConfigValue(key, before),
    });
  }

  /**
   * Carry a configured `cleanup_max_deletes_per_run` over to its replacement.
   *
   * The ceiling changed from per-run to per-rolling-day when cleanup got its own
   * job (a per-run cap bounded one batch and nothing else). The number a user
   * chose still expresses what they meant — "don't remove more than this without
   * me looking" — so it moves across rather than silently reverting to the
   * default. Called once from `initJobs`, before anything reads either key.
   */
  function migrateCleanupBudgetKey(): void {
    const legacy = getConfig("cleanup_max_deletes_per_run");
    if (legacy === undefined) return;
    if (getConfig("cleanup_max_deletes_per_day") === undefined) {
      setConfig("cleanup_max_deletes_per_day", legacy);
    }
    deleteConfig("cleanup_max_deletes_per_run");
  }

  /** Current personalization master-switch status (defaults to "disabled"). */
  function getPersonalizedSharingStatus(): PersonalizedSharingStatus {
    return getConfig("global_personalized_sharing")?.status ?? "disabled";
  }

  /**
   * Should the user portal be listening?
   *
   * It used to be personalization and nothing else, which stranded the two portal
   * features that have nothing to do with it:
   *
   * - "tell people before their films disappear" was unreachable unless the admin
   *   also turned on the heavyweight scheme that relabels every item in the
   *   library and restricts every user's access to it;
   * - a per-user digest frequency and address can *only* be set in the portal, so
   *   with the port closed nobody could ever subscribe — while the admin-side
   *   digest settings happily implied otherwise.
   *
   * It also made `portal.personalizationStatus` unreachable by construction: the
   * portal shows a banner when personalization is off, and the port was closed in
   * exactly that state.
   *
   * So: any portal-served feature being on is enough. Personalization mid-flip
   * (`enabling`/`disabling`) counts, so the portal doesn't blink during a
   * transition. Digests are represented by SMTP being configured, because that is
   * the admin-side half — subscribing is what the portal is for. Movie match
   * lives only in the portal, so its switch opens it too.
   */
  function portalShouldRun(): boolean {
    if (getPersonalizedSharingStatus() !== "disabled") return true;
    if (getConfig("cleanup_enabled") === true) return true;
    if ((getConfig("global_smtp")?.host ?? "") !== "") return true;
    if (getConfig("match_enabled") === true) return true;
    return false;
  }

  /**
   * Resolve the LLM provider config, falling back to the legacy
   * `global_anthropic_api_key` slot when `global_llm` hasn't been written yet.
   * Returns undefined when no provider is configured.
   */
  function getLlmConfig(): ConfigValue<"global_llm"> | undefined {
    const explicit = getConfig("global_llm");
    if (explicit) return explicit;
    const legacyKey = getConfig("global_anthropic_api_key");
    if (legacyKey) {
      return {
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        apiKey: legacyKey,
      };
    }
    return undefined;
  }

  function getAllConfig(): Partial<z.infer<ConfigSchema>> {
    const rows = db.select().from(config).all();
    const raw: Record<string, unknown> = {};
    for (const row of rows) {
      if (row.key in configSchema.shape) {
        raw[row.key] = row.value;
      }
    }
    return configSchema.partial().parse(raw);
  }

  /**
   * The inverse, for one key on the way back in: a form echoes the sentinel for a
   * secret the user didn't retype, and saving that verbatim would erase it. Lists
   * are matched element to element by `id`, so reordering or renaming an \*Arr
   * instance keeps its key and a genuinely new instance gets no borrowed one.
   */
  function restoreNestedSecrets<K extends ConfigKey>(key: K, value: ConfigValue<K>): ConfigValue<K> {
    const stored = getConfig(key);
    let next: unknown = value;
    for (const nested of NESTED_SECRETS) {
      if (nested.key !== key) continue;
      if (nested.each) {
        if (!Array.isArray(next)) continue;
        const byId = new Map<unknown, unknown>();
        if (Array.isArray(stored)) {
          for (const entry of stored) {
            if (entry && typeof entry === "object") byId.set((entry as Unknowns).id, entry);
          }
        }
        next = next.map((entry) => {
          const id = entry && typeof entry === "object" ? (entry as Unknowns).id : undefined;
          return restoreField(entry, byId.get(id), nested.field);
        });
      } else {
        next = restoreField(next, stored, nested.field);
      }
    }
    return next as ConfigValue<K>;
  }

  /**
   * Browser-safe variant of `getAllConfig`: keys in `SECRET_KEYS` that are
   * stored come back as `REDACTED_SECRET`; unset keys are omitted as usual.
   * `global_llm.apiKey` is a nested secret and is redacted in place.
   */
  function getAllConfigForClient(): Partial<z.infer<ConfigSchema>> {
    return redactSecrets(getAllConfig());
  }

  return {
    configuredTimezone,
    getConfig,
    setConfig,
    deleteConfig,
    migrateCleanupBudgetKey,
    getPersonalizedSharingStatus,
    portalShouldRun,
    getLlmConfig,
    getAllConfig,
    restoreNestedSecrets,
    getAllConfigForClient,
  };
}

export type ConfigStore = ReturnType<typeof createConfigStore>;

export const ConfigStoreToken = token<ConfigStore>("config");
