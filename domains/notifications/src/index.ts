/**
 * Which services exist, which events each one wants, and how an event becomes
 * a delivered message.
 */
import {
  errorMessage,
  isWithinClockWindow,
  type ConfigValue,
  type ConfigKey,
  type ConfigStore,
} from "@tinkerbell/core";
import {
  EVENT_TYPES,
  NOTIFICATION_SERVICES,
  plainMessage,
  type NotificationService,
  type RichMessage,
} from "./types.ts";
import { createSenders } from "./senders.ts";
import { createSmtp } from "./smtp.ts";
import { type EventBus } from "@tinkerbell/ports";
import { token } from "@tinkerbell/container";

export * from "./types.ts";
export { renderEmailHtml, SmtpNotConfiguredError, type SmtpTarget } from "./smtp.ts";

// --- Agent registry ---

type EventsConfigKey = {
  [K in ConfigKey]: ConfigValue<K> extends string[] ? K : never;
}[ConfigKey];

/**
 * The one event allowed through quiet hours, when the exemption is on.
 *
 * A server that has been unreachable since 2am is the thing worth waking up
 * for; without an exemption the honest choice is between being paged about a
 * flapping *Arr and hearing nothing at all, and most people faced with that
 * pick "nothing" and then miss the outage too.
 */
const URGENT_EVENTS = new Set(["plex.unreachable"]);

/* ─── Routing, as something you can look at ─────────────────────────────────
 *
 * Routing has three orthogonal axes per service — subscribed event types, a
 * job-id allow-list, a health-target allow-list — across nine services, plus
 * quiet hours with an urgent-event exemption on top. Every one of those is a
 * checkbox on a different tab, and the only feedback the app gave was a test
 * send that ignored all of it.
 *
 * This is the same decision `notifyEvent` makes, evaluated without sending
 * anything: the routing table you would otherwise have to reconstruct in your
 * head from four screens.
 */

export type RoutingState =
  /** Not subscribed to this event type at all. */
  | "off"
  /** Subscribed, and nothing narrows it. */
  | "on"
  /** Subscribed, but an allow-list means only some of these events arrive. */
  | "filtered"
  /**
   * Subscribed, but the service has no credentials — so the send throws.
   * Distinguished from "on" because a table that cannot tell you this is a
   * table you would have to verify by sending, which is what it replaced.
   */
  | "unconfigured";

export interface RoutingCell {
  service: NotificationService;
  state: RoutingState;
  /** The allow-list narrowing this cell, when `state` is "filtered". */
  filter?: string[];
}

export interface RoutingRow {
  type: string;
  label: string;
  services: RoutingCell[];
  /** Why this event would be dropped right now, or null if it would go out. */
  suppressed: string | null;
  /** False for `digest.sent`, which is a routing target rather than an event. */
  emitted: boolean;
}

/**
 * A representative body for an event type, for a test send.
 *
 * Event notifications are `plainMessage(label, text)` — there is no richer
 * form to preview — so what a test can honestly show is the title the service
 * will display and a body the same shape as the real one.
 */
export function sampleMessageFor(type: string): RichMessage {
  const label = EVENT_TYPES.find((e) => e.id === type)?.label ?? type;
  const samples: Record<string, string> = {
    "job.completed": "Sync Media completed in 42s — 127 items updated.",
    "job.failed": "Generate failed: Plex returned 401 Unauthorized.",
    "health.failed": "Radarr is unreachable (connect ETIMEDOUT).",
    "health.recovered": "Radarr is responding again.",
    "plex.unreachable": "Plex has not responded for 6 minutes.",
    "bandwidth.tested": "Downstream 412 Mbps, upstream 38 Mbps.",
    "cleanup.pending": "6 films are scheduled for deletion tomorrow unless kept.",
    "cleanup.actioned": "Removed 4 films, freeing 61 GB.",
    "metadata.written": "Wrote metadata to 18 items (batch 3f2a1c).",
    "media.added": "127 new files in Movies, including Sinners (2025).",
    "collection.created": "Created “Directed by Christopher Nolan” with 12 items.",
    "rule.empty": "“Oscar Winners” matched nothing this run — it matched 34 last run.",
    "registry.update_available": "3 registry rules have updates available.",
    "watchlist.requested": 'Requested "Sinners" from radarr.',
    "watchlist.failed": 'Couldn\'t request "Sinners" — sonarr returned 401 Unauthorized.',
    "digest.sent": "Your weekly digest — 12 added, 3 leaving soon.",
  };
  return plainMessage(label, `${samples[type] ?? "Test notification from Tinkerbell."} (test)`);
}

export { NOTIFICATION_SERVICES };

export interface NotificationsDeps {
  config: ConfigStore;
  emitEvent: EventBus;
}
export function createNotifications(deps: NotificationsDeps) {
  const senders = createSenders(deps);
  const smtp = createSmtp(deps);
  const { sendDiscord, sendGotify, sendLunaSea, sendPushbullet, sendPushover, sendSlack, sendTelegram, sendWebhook } =
    senders;
  const { sendSmtp } = smtp;
  // Aliased so `serviceConfigured` can ask whether SMTP has credentials
  // without shadowing the `smtpConfigured` it re-exports.
  const smtpHasCredentials = smtp.smtpConfigured;

  const AGENTS: Array<{
    name: NotificationService;
    eventsKey: EventsConfigKey;
    jobsKey: EventsConfigKey;
    healthKey: EventsConfigKey;
    send: (message: RichMessage) => Promise<void>;
  }> = [
    {
      name: "pushover",
      eventsKey: "global_pushover_events",
      jobsKey: "global_pushover_jobs",
      healthKey: "global_pushover_health_targets",
      send: sendPushover,
    },
    {
      name: "discord",
      eventsKey: "global_discord_events",
      jobsKey: "global_discord_jobs",
      healthKey: "global_discord_health_targets",
      send: sendDiscord,
    },
    {
      name: "gotify",
      eventsKey: "global_gotify_events",
      jobsKey: "global_gotify_jobs",
      healthKey: "global_gotify_health_targets",
      send: sendGotify,
    },
    {
      name: "lunasea",
      eventsKey: "global_lunasea_events",
      jobsKey: "global_lunasea_jobs",
      healthKey: "global_lunasea_health_targets",
      send: sendLunaSea,
    },
    {
      name: "pushbullet",
      eventsKey: "global_pushbullet_events",
      jobsKey: "global_pushbullet_jobs",
      healthKey: "global_pushbullet_health_targets",
      send: sendPushbullet,
    },
    {
      name: "slack",
      eventsKey: "global_slack_events",
      jobsKey: "global_slack_jobs",
      healthKey: "global_slack_health_targets",
      send: sendSlack,
    },
    {
      name: "telegram",
      eventsKey: "global_telegram_events",
      jobsKey: "global_telegram_jobs",
      healthKey: "global_telegram_health_targets",
      send: sendTelegram,
    },
    {
      name: "webhook",
      eventsKey: "global_webhook_events",
      jobsKey: "global_webhook_jobs",
      healthKey: "global_webhook_health_targets",
      send: sendWebhook,
    },
    {
      name: "smtp",
      eventsKey: "global_smtp_events",
      jobsKey: "global_smtp_jobs",
      healthKey: "global_smtp_health_targets",
      // Addressed to `global_smtp.to` — the admin's own inbox. Per-user digests
      // never come through here; they call `sendSmtp` with an explicit
      // recipient, so there is no path by which an event notification could be
      // delivered to a shared user.
      send: (message) => sendSmtp(message),
    },
  ];

  const { getConfig } = deps.config;
  const { emitEvent } = deps;

  /**
   * Does this service hold enough configuration to send anything at all?
   *
   * Subscribing to an event is not the same as being able to deliver it: a Slack
   * row with every event ticked and no webhook URL throws "Slack webhook URL is
   * required" on the first send. The routing table used to read "on" for exactly
   * that, which is the one thing it exists to stop happening.
   */
  function sendNotification(service: NotificationService, title: string, message: string): Promise<void> {
    return sendRichNotification(service, plainMessage(title, message));
  }

  function sendRichNotification(service: NotificationService, message: RichMessage): Promise<void> {
    const agent = AGENTS.find((a) => a.name === service);
    if (!agent) throw new Error(`Unknown notification service: ${service}`);
    return agent.send(message);
  }

  function serviceConfigured(service: NotificationService): boolean {
    switch (service) {
      case "pushover":
        return !!(getConfig("global_pushover_api_key") && getConfig("global_pushover_user_key"));
      case "discord":
        return !!getConfig("global_discord_webhook_url");
      case "gotify":
        return !!(getConfig("global_gotify_url") && getConfig("global_gotify_token"));
      case "lunasea":
        return !!getConfig("global_lunasea_webhook_url");
      case "pushbullet":
        return !!getConfig("global_pushbullet_token");
      case "slack":
        return !!getConfig("global_slack_webhook_url");
      case "telegram":
        return !!(getConfig("global_telegram_bot_token") && getConfig("global_telegram_chat_id"));
      case "webhook":
        return !!getConfig("global_webhook_url");
      case "smtp":
        return smtpHasCredentials();
      default:
        return false;
    }
  }

  /** Which services currently hold enough configuration to send anything. */
  function configuredServices(): NotificationService[] {
    return AGENTS.filter((agent) => serviceConfigured(agent.name)).map((agent) => agent.name);
  }

  /** Services subscribed to a given event type. */
  function servicesForEvent(type: string): NotificationService[] {
    return AGENTS.filter((agent) => (getConfig(agent.eventsKey) ?? []).includes(type)).map((agent) => agent.name);
  }

  /**
   * Should delivery be suppressed right now?
   *
   * Suppression is delivery-only and deliberately late — the event is already
   * recorded by the time this runs, so the activity feed in the morning is
   * complete whatever the channels did overnight.
   */
  function suppressionReason(type: string, service: string | undefined, now: Date = new Date()): string | null {
    if (service) {
      const mutedUntil = getConfig("health_mutes")?.[service];
      if (mutedUntil && mutedUntil > now.getTime() && (type.startsWith("health.") || URGENT_EVENTS.has(type))) {
        return `${service} is muted`;
      }
    }

    const quiet = getConfig("notifications_quiet_hours");
    if (quiet?.enabled && isWithinClockWindow(quiet.from, quiet.to, now, getConfig("global_timezone") || undefined)) {
      if (quiet.allowUrgent && URGENT_EVENTS.has(type)) return null;
      return `quiet hours (${quiet.from}–${quiet.to})`;
    }

    return null;
  }

  /** The whole event × service grid, plus why anything is currently muted. */
  function routingMatrix(now: Date = new Date()): RoutingRow[] {
    return EVENT_TYPES.map((event) => ({
      type: event.id,
      label: event.label,
      emitted: event.id !== "digest.sent",
      // No service name: quiet hours are a statement about the server, and the
      // per-service mute only applies to health events, which the cell's own
      // allow-list already describes.
      suppressed: suppressionReason(event.id, undefined, now),
      services: AGENTS.map((agent): RoutingCell => {
        if (!(getConfig(agent.eventsKey) ?? []).includes(event.id)) return { service: agent.name, state: "off" };
        if (!serviceConfigured(agent.name)) return { service: agent.name, state: "unconfigured" };

        // An empty allow-list means "all of them", which is why these read as
        // `length > 0` rather than as a plain presence check.
        const filterKey = event.id.startsWith("job.")
          ? agent.jobsKey
          : event.id.startsWith("health.")
            ? agent.healthKey
            : null;
        const filter = filterKey ? (getConfig(filterKey) ?? []) : [];

        return filter.length > 0
          ? { service: agent.name, state: "filtered", filter }
          : { service: agent.name, state: "on" };
      }),
    }));
  }

  function notifyEvent(type: string, message: string, metadata?: Record<string, unknown>): void {
    const label = EVENT_TYPES.find((e) => e.id === type)?.label ?? type;
    const jobId = typeof metadata?.jobId === "string" ? metadata.jobId : undefined;
    const healthService = typeof metadata?.service === "string" ? metadata.service : undefined;

    // Checked once for the whole dispatch: quiet hours and mutes are statements
    // about the server, not about any one channel.
    const suppressed = suppressionReason(type, healthService);
    if (suppressed) {
      // Record what didn't go out. Quiet hours were previously invisible: the
      // event itself is in the feed either way, so an admin reading it in the
      // morning had no way to tell whether their phone had stayed silent by
      // design or because a webhook URL had rotted.
      //
      // The `notification.` guard is the same recursion break as the send-failure
      // path below, and it is load-bearing rather than defensive: `emitEvent`
      // calls straight back into this function.
      const recipients = servicesForEvent(type);
      if (!type.startsWith("notification.") && recipients.length > 0) {
        emitEvent("notification.suppressed", `${label} not sent to ${recipients.join(", ")} — ${suppressed}`, {
          originalType: type,
          reason: suppressed,
          services: recipients,
        });
      }
      return;
    }

    for (const agent of AGENTS) {
      const enabledEvents = getConfig(agent.eventsKey);
      if (!enabledEvents || !enabledEvents.includes(type)) continue;

      if (type.startsWith("job.")) {
        const jobs = getConfig(agent.jobsKey);
        if (jobs && jobs.length > 0 && (!jobId || !jobs.includes(jobId))) continue;
      }

      if (type.startsWith("health.")) {
        const targets = getConfig(agent.healthKey);
        if (targets && targets.length > 0 && (!healthService || !targets.includes(healthService))) continue;
      }

      agent.send(plainMessage(label, message)).catch((err) => {
        console.error(`[${agent.name}] Error sending notification:`, err);
        // Surface to the activity feed so silent channel failures (dead
        // webhook URL, expired token, etc.) become visible. Guard against
        // the obvious recursion: a failed `notification.*.failed` send must
        // not re-emit a `notification.*.failed` event.
        if (!type.startsWith("notification.")) {
          emitEvent(
            `notification.${agent.name}.failed`,
            `Failed to send ${label} via ${agent.name}: ${errorMessage(err)}`,
            { service: agent.name, originalType: type, ...(jobId ? { jobId } : {}) },
          );
        }
      });
    }
  }

  return {
    ...senders,
    ...smtp,
    sendNotification,
    sendRichNotification,
    serviceConfigured,
    configuredServices,
    servicesForEvent,
    suppressionReason,
    routingMatrix,
    notifyEvent,
  };
}

export type Notifications = ReturnType<typeof createNotifications>;

export const NotificationsToken = token<Notifications>("notifications");
