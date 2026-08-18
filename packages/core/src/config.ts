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
import { config, type Db } from "@tinkerbell/db";
import { createLogger } from "./logger.ts";
import { errorMessage } from "./util.ts";

const timezoneLog = createLogger("timezone");

/**
 * Does the runtime's ICU data recognise this timezone?
 *
 * An empty string is accepted as "unset" — that's how the Settings form clears
 * the setting back to following the server's own clock.
 */
export function isValidTimezone(value: string): boolean {
  if (value.trim() === "") return true;
  try {
    // Throws RangeError on an unknown zone. This is the same check croner
    // performs internally, done somewhere we can still report it to the user.
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

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
  global_anthropic_api_key: z.string(),
  global_llm: z.object({
    provider: z.enum(["anthropic", "openai", "gemini", "ollama", "openai-compatible"]),
    model: z.string(),
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional(),
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
  }),
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
  global_seerr_url: z.string(),
  global_seerr_api_key: z.string(),
  global_omdb_api_key: z.string(),
  global_mdblist_api_key: z.string(),
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
        replacesRatingKeys: z.array(z.string()),
      }),
    ),
    deleteOriginals: z.boolean(),
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
];

/** Keys carrying a nested secret, for callers that only need the question answered. */
export const NESTED_SECRET_KEYS = new Set<ConfigKey>(NESTED_SECRETS.map((n) => n.key));

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

export interface ConfigStoreDeps {
  db: Db;
}

export function createConfigStore(deps: ConfigStoreDeps) {
  const { db } = deps;

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

  function setConfig<K extends ConfigKey>(key: K, value: ConfigValue<K>): void {
    db.insert(config).values({ key, value }).onConflictDoUpdate({ target: config.key, set: { value } }).run();
  }

  function deleteConfig(key: ConfigKey): void {
    db.delete(config).where(eq(config.key, key)).run();
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
   * the admin-side half — subscribing is what the portal is for.
   */
  function portalShouldRun(): boolean {
    if (getPersonalizedSharingStatus() !== "disabled") return true;
    if (getConfig("cleanup_enabled") === true) return true;
    if ((getConfig("global_smtp")?.host ?? "") !== "") return true;
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
