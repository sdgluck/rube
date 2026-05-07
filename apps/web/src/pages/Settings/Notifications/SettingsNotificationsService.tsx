import { useParams, Navigate } from "react-router-dom";
import NotificationServiceForm from "./NotificationServiceForm";
import { NOTIFICATION_SERVICES } from "./notifications.config";

export default function SettingsNotificationsService() {
  const { service } = useParams<{ service: string }>();
  const cfg = service ? NOTIFICATION_SERVICES[service] : undefined;
  if (!cfg) return <Navigate to="/settings/notifications/discord" replace />;
  return (
    <NotificationServiceForm
      service={cfg.service}
      title={cfg.title}
      fields={cfg.fields}
      eventsKey={cfg.eventsKey}
      jobsKey={cfg.jobsKey}
      healthTargetsKey={cfg.healthTargetsKey}
    />
  );
}
