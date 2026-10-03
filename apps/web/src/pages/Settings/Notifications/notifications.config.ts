import type { NotificationField } from "./NotificationServiceForm";
import {
  readSmtpEncryption,
  SMTP_ENCRYPTION_OPTIONS,
  writeSmtpEncryption,
  type SmtpEncryption,
} from "./smtpEncryption";

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
        hint: "Channel settings → Integrations → Webhooks",
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
      },
      {
        key: "global_gotify_token",
        label: "Application Token",
        type: "password",
        placeholder: "Enter Gotify application token",
        hint: "Create an application in Gotify",
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
        hint: "In LunaSea under Settings › Notifications",
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
        hint: "pushbullet.com › Settings › Access Tokens",
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
        hint: "Create an application at pushover.net",
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
        key: "encryption",
        label: "Encryption",
        derived: {
          options: SMTP_ENCRYPTION_OPTIONS,
          read: (v) => readSmtpEncryption(!!v.secure, String(v.port ?? "")),
          write: (mode, v) => writeSmtpEncryption(mode as SmtpEncryption, String(v.port ?? "")),
        },
      },
      { key: "port", label: "Port", type: "number", placeholder: "587" },
      { key: "secure", label: "Implicit TLS", type: "checkbox", hidden: true },
      { key: "user", label: "Username", placeholder: "Leave blank for an open relay" },
      { key: "password", label: "Password", type: "password", placeholder: "Enter SMTP password" },
      {
        key: "from",
        label: "From Address",
        placeholder: "tinkerbell@example.com",
        hint: "Many providers require this to match the username",
      },
      {
        key: "to",
        label: "Your Address",
        placeholder: "you@example.com",
        hint: "Gets events and the server digest; users set their own",
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
        hint: "An Incoming Webhook from your Slack app settings",
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
        hint: "From @BotFather",
      },
      {
        key: "global_telegram_chat_id",
        label: "Chat ID",
        placeholder: "Enter chat ID or group ID",
        hint: "Message your bot first, then Detect",
        action: {
          label: "Detect",
          busyLabel: "Detecting…",
          run: async (values, client) => {
            const { chats } = await client.notifications.detectTelegramChats.mutate({
              token: String(values.global_telegram_bot_token ?? ""),
            });
            const [latest] = chats;
            if (!latest) throw new Error("No messages yet — message your bot, then try again");
            return {
              value: latest.id,
              message:
                chats.length > 1
                  ? `Using ${latest.title}, the most recent of ${chats.length} chats`
                  : `Found ${latest.title}`,
            };
          },
        },
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
        hint: "Receives a JSON POST per notification",
        sample: [
          "{",
          '  "title": "Plex Unreachable",',
          '  "message": "Plex has not answered for 3 minutes",',
          '  "timestamp": 1767225600000,',
          '  "blocks": [ … ],  // when the event has them',
          '  "data": { … }     // when the event has them',
          "}",
        ].join("\n"),
      },
    ],
    credentialKeys: ["global_webhook_url"],
    eventsKey: "global_webhook_events",
    jobsKey: "global_webhook_jobs",
    healthTargetsKey: "global_webhook_health_targets",
  },
};
