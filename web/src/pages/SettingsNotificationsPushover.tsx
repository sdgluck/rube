import NotificationServiceForm from "./NotificationServiceForm";

export default function SettingsNotificationsPushover() {
  return (
    <NotificationServiceForm
      service="pushover"
      title="Pushover"
      fields={[
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
      ]}
      eventsKey="global_pushover_events"
    />
  );
}
