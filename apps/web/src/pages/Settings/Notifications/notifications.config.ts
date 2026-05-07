import type { NotificationField } from "./NotificationServiceForm";

export interface NotificationServiceConfig {
  service: string;
  title: string;
  fields: NotificationField[];
  eventsKey: string;
  jobsKey: string;
  healthTargetsKey: string;
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
    eventsKey: "global_pushover_events",
    jobsKey: "global_pushover_jobs",
    healthTargetsKey: "global_pushover_health_targets",
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
    eventsKey: "global_webhook_events",
    jobsKey: "global_webhook_jobs",
    healthTargetsKey: "global_webhook_health_targets",
  },
};
