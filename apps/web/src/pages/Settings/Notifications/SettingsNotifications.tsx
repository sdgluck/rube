import { NavLink, Outlet } from "react-router-dom";
import { trpc } from "#/trpc";
import SettingsPageHeader from "#pages/Settings/SettingsPageHeader";
import styles from "#pages/Settings/Settings.module.css";
import { NOTIFICATION_SERVICES, type NotificationServiceConfig } from "./notifications.config";

/**
 * Derived from `NOTIFICATION_SERVICES` rather than repeated beside it. The two
 * lists used to be maintained by hand, which is one edit away from a service
 * that has a form but no tab to reach it from.
 */
const TABS = Object.values(NOTIFICATION_SERVICES)
  .map((svc) => ({ to: svc.service, label: svc.title, service: svc }))
  .sort((a, b) => a.label.localeCompare(b.label));

function isServiceEnabled(cfg: Record<string, unknown>, service: NotificationServiceConfig): boolean {
  const source = service.objectKey ? ((cfg[service.objectKey] as Record<string, unknown>) ?? {}) : cfg;
  const hasCredentials = service.credentialKeys.every((key) => {
    const value = source[key];
    // A port is a number, not a string — an object-backed service can hold
    // either, so "set to something truthy" is the test rather than "non-empty
    // string", which silently read every SMTP config as unconfigured.
    if (typeof value === "number") return value > 0;
    return typeof value === "string" && value.length > 0;
  });
  const events = cfg[service.eventsKey];
  const hasEvents = Array.isArray(events) && events.length > 0;
  return hasCredentials && hasEvents;
}

export default function SettingsNotifications() {
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const cfg = (configQuery.data ?? {}) as Record<string, unknown>;

  return (
    <div>
      <SettingsPageHeader title="Notifications" />
      <nav className={styles.subTabs} aria-label="Notification services">
        {/* First, and not a service: quiet hours and the failure threshold
            apply to every destination, so they belong beside them rather than
            repeated on each one. */}
        <NavLink
          to="/settings/notifications/delivery"
          className={({ isActive }) => `${styles.subTab} ${isActive ? styles.subTabActive : ""}`}
        >
          Delivery
        </NavLink>
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={`/settings/notifications/${tab.to}`}
            className={({ isActive }) => `${styles.subTab} ${isActive ? styles.subTabActive : ""}`}
          >
            {isServiceEnabled(cfg, tab.service) && <span className={styles.enabledDot} />}
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
