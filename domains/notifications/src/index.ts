/**
 * Which services exist, which events each one wants, and how an event becomes
 * a delivered message.
 */
import { getConfig, emitEventViaHook, errorMessage, type ConfigValue, type ConfigKey } from "@tinkerbell/core";
import {
  EVENT_TYPES,
  NOTIFICATION_SERVICES,
  plainMessage,
  type NotificationService,
  type RichMessage,
} from "./types.ts";
import {
  sendDiscord,
  sendGotify,
  sendLunaSea,
  sendPushbullet,
  sendPushover,
  sendSlack,
  sendTelegram,
  sendWebhook,
} from "./senders.ts";
import { sendSmtp } from "./smtp.ts";

export * from "./types.ts";
export {
  sendDiscord,
  sendGotify,
  sendLunaSea,
  sendPushbullet,
  sendPushover,
  sendSlack,
  sendTelegram,
  sendWebhook,
} from "./senders.ts";
export { sendSmtp, smtpConfigured, renderEmailHtml, SmtpNotConfiguredError, type SmtpTarget } from "./smtp.ts";

// --- Agent registry ---

type EventsConfigKey = {
  [K in ConfigKey]: ConfigValue<K> extends string[] ? K : never;
}[ConfigKey];

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

/** Which services currently hold enough configuration to send anything. */
export function configuredServices(): NotificationService[] {
  return AGENTS.filter((agent) => (getConfig(agent.eventsKey) ?? []).length > 0).map((agent) => agent.name);
}

/** Services subscribed to a given event type. */
export function servicesForEvent(type: string): NotificationService[] {
  return AGENTS.filter((agent) => (getConfig(agent.eventsKey) ?? []).includes(type)).map((agent) => agent.name);
}

export function sendNotification(service: NotificationService, title: string, message: string): Promise<void> {
  return sendRichNotification(service, plainMessage(title, message));
}

export function sendRichNotification(service: NotificationService, message: RichMessage): Promise<void> {
  const agent = AGENTS.find((a) => a.name === service);
  if (!agent) throw new Error(`Unknown notification service: ${service}`);
  return agent.send(message);
}

export function notifyEvent(type: string, message: string, metadata?: Record<string, unknown>): void {
  const label = EVENT_TYPES.find((e) => e.id === type)?.label ?? type;
  const jobId = typeof metadata?.jobId === "string" ? metadata.jobId : undefined;
  const healthService = typeof metadata?.service === "string" ? metadata.service : undefined;

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
        emitEventViaHook(
          `notification.${agent.name}.failed`,
          `Failed to send ${label} via ${agent.name}: ${errorMessage(err)}`,
          { service: agent.name, originalType: type, ...(jobId ? { jobId } : {}) },
        );
      }
    });
  }
}

export { NOTIFICATION_SERVICES };
