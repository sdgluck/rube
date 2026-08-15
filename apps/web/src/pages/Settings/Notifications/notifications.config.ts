import type { NotificationField } from "./NotificationServiceForm";

export interface NotificationServiceConfig {
  service: string;
  title: string;
  fields: NotificationField[];
  eventsKey: string;
  jobsKey: string;
  healthTargetsKey: string;
  /** Set when the service's settings live inside one config object. */
  objectKey?: string;
  /**
   * The fields without which the service cannot send anything. Drives the
   * "configured" dot in the tab rail. Field keys, so a service with an
   * `objectKey` names them relative to that object.
   */
  credentialKeys: string[];
}

export const NOTIFICATION_SERVICES: Record<string, NotificationServiceConfig> = {
  discord: {
    service: "discord",
    title: "Discord",
    fields: [
      {
        key: "global_discord_webhook_url",
        label: "Webhook URL",
        placeholder: "https://discord.com/api/webhooks/...",
        hint: "Create a webhook in your Discord server's channel settings under Integrations",
      },
    ],
    credentialKeys: ["global_discord_webhook_url"],
    eventsKey: "global_discord_events",
    jobsKey: "global_discord_jobs",
    healthTargetsKey: "global_discord_health_targets",
  },
  gotify: {
    service: "gotify",
    title: "Gotify",
    fields: [
      {
        key: "global_gotify_url",
        label: "Server URL",
        placeholder: "https://gotify.example.com",
        hint: "The base URL of your Gotify server",
      },
      {
        key: "global_gotify_token",
        label: "Application Token",
        type: "password",
        placeholder: "Enter Gotify application token",
        hint: "Create an application in Gotify to get a token",
      },
    ],
    credentialKeys: ["global_gotify_url", "global_gotify_token"],
    eventsKey: "global_gotify_events",
    jobsKey: "global_gotify_jobs",
    healthTargetsKey: "global_gotify_health_targets",
  },
  lunasea: {
    service: "lunasea",
    title: "LunaSea",
    fields: [
      {
        key: "global_lunasea_webhook_url",
        label: "Webhook URL",
        placeholder: "https://notify.lunasea.app/v1/custom/...",
        hint: "Found in the LunaSea app under Settings > Notifications",
      },
    ],
    credentialKeys: ["global_lunasea_webhook_url"],
    eventsKey: "global_lunasea_events",
    jobsKey: "global_lunasea_jobs",
    healthTargetsKey: "global_lunasea_health_targets",
  },
  pushbullet: {
    service: "pushbullet",
    title: "Pushbullet",
    fields: [
      {
        key: "global_pushbullet_token",
        label: "Access Token",
        type: "password",
        placeholder: "Enter Pushbullet access token",
        hint: "Found at pushbullet.com under Settings > Access Tokens",
      },
    ],
    credentialKeys: ["global_pushbullet_token"],
    eventsKey: "global_pushbullet_events",
    jobsKey: "global_pushbullet_jobs",
    healthTargetsKey: "global_pushbullet_health_targets",
  },
  pushover: {
    service: "pushover",
    title: "Pushover",
    fields: [
      {
        key: "global_pushover_api_key",
        label: "API Key (Application Token)",
        type: "password",
        placeholder: "Enter Pushover API key",
        hint: "Create an application at pushover.net to get a token",
      },
      {
        key: "global_pushover_user_key",
        label: "User Key",
        type: "password",
        placeholder: "Enter Pushover user key",
        hint: "Found on your Pushover dashboard",
      },
    ],
    credentialKeys: ["global_pushover_api_key", "global_pushover_user_key"],
    eventsKey: "global_pushover_events",
    jobsKey: "global_pushover_jobs",
    healthTargetsKey: "global_pushover_health_targets",
  },
  smtp: {
    service: "smtp",
    title: "Email",
    objectKey: "global_smtp",
    fields: [
      {
        key: "host",
        label: "SMTP Host",
        placeholder: "smtp.example.com",
        hint: "Your mail provider's outgoing server",
      },
      {
        key: "port",
        label: "Port",
        type: "number",
        placeholder: "587",
        hint: "587 for STARTTLS, 465 for implicit TLS, 25 for an unauthenticated relay on your LAN",
      },
      {
        key: "secure",
        label: "Use implicit TLS (port 465)",
        type: "checkbox",
        hint: "Leave off for port 587 — STARTTLS is negotiated automatically",
      },
      { key: "user", label: "Username", placeholder: "Leave blank for an open relay" },
      { key: "password", label: "Password", type: "password", placeholder: "Enter SMTP password" },
      {
        key: "from",
        label: "From Address",
        placeholder: "tinkerbell@example.com",
        hint: "What recipients see in the From field. Many providers require this to match the authenticated account",
      },
      {
        key: "to",
        label: "Your Address",
        placeholder: "you@example.com",
        hint: "Where event notifications and the server-wide digest go. Per-user digests go to the address each portal user enters themselves",
      },
    ],
    credentialKeys: ["host", "port", "from"],
    eventsKey: "global_smtp_events",
    jobsKey: "global_smtp_jobs",
    healthTargetsKey: "global_smtp_health_targets",
  },
  slack: {
    service: "slack",
    title: "Slack",
    fields: [
      {
        key: "global_slack_webhook_url",
        label: "Webhook URL",
        placeholder: "https://hooks.slack.com/services/...",
        hint: "Create an Incoming Webhook in your Slack workspace's app settings",
      },
    ],
    credentialKeys: ["global_slack_webhook_url"],
    eventsKey: "global_slack_events",
    jobsKey: "global_slack_jobs",
    healthTargetsKey: "global_slack_health_targets",
  },
  telegram: {
    service: "telegram",
    title: "Telegram",
    fields: [
      {
        key: "global_telegram_bot_token",
        label: "Bot Token",
        type: "password",
        placeholder: "Enter Telegram bot token",
        hint: "Create a bot via @BotFather and copy the token",
      },
      {
        key: "global_telegram_chat_id",
        label: "Chat ID",
        placeholder: "Enter chat ID or group ID",
        hint: "Send a message to your bot, then visit api.telegram.org/bot<token>/getUpdates to find your chat ID",
      },
      {
        key: "global_telegram_send_silently",
        label: "Send silently (no notification sound)",
        type: "checkbox",
      },
    ],
    credentialKeys: ["global_telegram_bot_token", "global_telegram_chat_id"],
    eventsKey: "global_telegram_events",
    jobsKey: "global_telegram_jobs",
    healthTargetsKey: "global_telegram_health_targets",
  },
  webhook: {
    service: "webhook",
    title: "Webhook",
    fields: [
      {
        key: "global_webhook_url",
        label: "Webhook URL",
        placeholder: "https://example.com/webhook",
        hint: 'Receives a POST with JSON body: { "title": "...", "message": "...", "timestamp": ... }',
      },
    ],
    credentialKeys: ["global_webhook_url"],
    eventsKey: "global_webhook_events",
    jobsKey: "global_webhook_jobs",
    healthTargetsKey: "global_webhook_health_targets",
  },
};
