import NotificationServiceForm from "./NotificationServiceForm";

export default function SettingsNotificationsGotify() {
  return (
    <NotificationServiceForm
      service="gotify"
      title="Gotify"
      fields={[
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
      ]}
      eventsKey="global_gotify_events"
      jobsKey="global_gotify_jobs"
      healthTargetsKey="global_gotify_health_targets"
    />
  );
}
