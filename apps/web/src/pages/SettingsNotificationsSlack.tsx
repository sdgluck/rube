import NotificationServiceForm from "./NotificationServiceForm";

export default function SettingsNotificationsSlack() {
  return (
    <NotificationServiceForm
      service="slack"
      title="Slack"
      fields={[
        {
          key: "global_slack_webhook_url",
          label: "Webhook URL",
          placeholder: "https://hooks.slack.com/services/...",
          hint: "Create an Incoming Webhook in your Slack workspace's app settings",
        },
      ]}
      eventsKey="global_slack_events"
    />
  );
}
