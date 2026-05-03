import NotificationServiceForm from "./NotificationServiceForm";

export default function SettingsNotificationsWebhook() {
  return (
    <NotificationServiceForm
      service="webhook"
      title="Webhook"
      fields={[
        {
          key: "global_webhook_url",
          label: "Webhook URL",
          placeholder: "https://example.com/webhook",
          hint: 'Receives a POST with JSON body: { "title": "...", "message": "...", "timestamp": ... }',
        },
      ]}
      eventsKey="global_webhook_events"
    />
  );
}
