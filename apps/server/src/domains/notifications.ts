import { getConfig, type ConfigValue, type ConfigKey } from "../lib/config.ts";

export const EVENT_TYPES = [
  { id: "job.completed", label: "Job Completed" },
  { id: "job.failed", label: "Job Failed" },
  { id: "health.failed", label: "Health Check Failed" },
  { id: "health.recovered", label: "Health Check Recovered" },
] as const;

export const NOTIFICATION_SERVICES = [
  "pushover",
  "discord",
  "gotify",
  "lunasea",
  "pushbullet",
  "slack",
  "telegram",
  "webhook",
] as const;

export type NotificationService = (typeof NOTIFICATION_SERVICES)[number];

// --- Send functions ---

export async function sendPushover(title: string, message: string): Promise<void> {
  const apiKey = getConfig("global_pushover_api_key");
  const userKey = getConfig("global_pushover_user_key");
  if (!apiKey || !userKey) throw new Error("Pushover API key and user key are required");

  const res = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: apiKey, user: userKey, title, message }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pushover: ${res.status} ${body}`);
  }
}

export async function sendDiscord(title: string, message: string): Promise<void> {
  const webhookUrl = getConfig("global_discord_webhook_url");
  if (!webhookUrl) throw new Error("Discord webhook URL is required");

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{ title, description: message, color: 0x237feb }],
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Discord: ${res.status} ${body}`);
  }
}

export async function sendGotify(title: string, message: string): Promise<void> {
  const url = getConfig("global_gotify_url");
  const token = getConfig("global_gotify_token");
  if (!url || !token) throw new Error("Gotify URL and application token are required");

  const endpoint = new URL("/message", url);
  const res = await fetch(endpoint.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Gotify-Key": token },
    body: JSON.stringify({ title, message, priority: 5 }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gotify: ${res.status} ${body}`);
  }
}

export async function sendLunaSea(title: string, message: string): Promise<void> {
  const webhookUrl = getConfig("global_lunasea_webhook_url");
  if (!webhookUrl) throw new Error("LunaSea webhook URL is required");

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body: message }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LunaSea: ${res.status} ${body}`);
  }
}

export async function sendPushbullet(title: string, message: string): Promise<void> {
  const token = getConfig("global_pushbullet_token");
  if (!token) throw new Error("Pushbullet access token is required");

  const res = await fetch("https://api.pushbullet.com/v2/pushes", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Access-Token": token },
    body: JSON.stringify({ type: "note", title, body: message }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pushbullet: ${res.status} ${body}`);
  }
}

export async function sendSlack(title: string, message: string): Promise<void> {
  const webhookUrl = getConfig("global_slack_webhook_url");
  if (!webhookUrl) throw new Error("Slack webhook URL is required");

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `*${title}*\n${message}`,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack: ${res.status} ${body}`);
  }
}

export async function sendTelegram(title: string, message: string): Promise<void> {
  const botToken = getConfig("global_telegram_bot_token");
  const chatId = getConfig("global_telegram_chat_id");
  if (!botToken || !chatId) throw new Error("Telegram bot token and chat ID are required");

  const sendSilently = getConfig("global_telegram_send_silently") ?? false;

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `<b>${title}</b>\n${message}`,
      parse_mode: "HTML",
      disable_notification: sendSilently,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram: ${res.status} ${body}`);
  }
}

export async function sendWebhook(title: string, message: string): Promise<void> {
  const url = getConfig("global_webhook_url");
  if (!url) throw new Error("Webhook URL is required");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, message, timestamp: Date.now() }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Webhook: ${res.status} ${body}`);
  }
}

// --- Agent registry ---

type EventsConfigKey = {
  [K in ConfigKey]: ConfigValue<K> extends string[] ? K : never;
}[ConfigKey];

const AGENTS: Array<{
  name: NotificationService;
  eventsKey: EventsConfigKey;
  jobsKey: EventsConfigKey;
  healthKey: EventsConfigKey;
  send: (title: string, message: string) => Promise<void>;
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
];

export function sendNotification(service: NotificationService, title: string, message: string): Promise<void> {
  const agent = AGENTS.find((a) => a.name === service);
  if (!agent) throw new Error(`Unknown notification service: ${service}`);
  return agent.send(title, message);
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

    agent.send(label, message).catch((err) => {
      console.error(`[${agent.name}] Error sending notification:`, err);
    });
  }
}
