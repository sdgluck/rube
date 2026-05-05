import NotificationServiceForm from "./NotificationServiceForm";

export default function SettingsNotificationsDiscord() {
  return (
    <NotificationServiceForm
      service="discord"
      title="Discord"
      fields={[
        {
          key: "global_discord_webhook_url",
          label: "Webhook URL",
          placeholder: "https://discord.com/api/webhooks/...",
          hint: "Create a webhook in your Discord server's channel settings under Integrations",
        },
      ]}
      eventsKey="global_discord_events"
      jobsKey="global_discord_jobs"
      healthTargetsKey="global_discord_health_targets"
    />
  );
}
