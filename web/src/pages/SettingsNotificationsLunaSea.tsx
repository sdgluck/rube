import NotificationServiceForm from "./NotificationServiceForm";

export default function SettingsNotificationsLunaSea() {
  return (
    <NotificationServiceForm
      service="lunasea"
      title="LunaSea"
      fields={[
        {
          key: "global_lunasea_webhook_url",
          label: "Webhook URL",
          placeholder: "https://notify.lunasea.app/v1/custom/...",
          hint: "Found in the LunaSea app under Settings > Notifications",
        },
      ]}
      eventsKey="global_lunasea_events"
    />
  );
}
