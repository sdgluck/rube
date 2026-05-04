import NotificationServiceForm from "./NotificationServiceForm";

export default function SettingsNotificationsPushbullet() {
  return (
    <NotificationServiceForm
      service="pushbullet"
      title="Pushbullet"
      fields={[
        {
          key: "global_pushbullet_token",
          label: "Access Token",
          type: "password",
          placeholder: "Enter Pushbullet access token",
          hint: "Found at pushbullet.com under Settings > Access Tokens",
        },
      ]}
      eventsKey="global_pushbullet_events"
      jobsKey="global_pushbullet_jobs"
      healthTargetsKey="global_pushbullet_health_targets"
    />
  );
}
