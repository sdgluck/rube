import { NavLink, Outlet } from "react-router-dom";
import styles from "./Settings.module.css";

const TABS = [
  { to: "discord", label: "Discord" },
  { to: "gotify", label: "Gotify" },
  { to: "lunasea", label: "LunaSea" },
  { to: "pushbullet", label: "Pushbullet" },
  { to: "pushover", label: "Pushover" },
  { to: "slack", label: "Slack" },
  { to: "telegram", label: "Telegram" },
  { to: "webhook", label: "Webhook" },
];

export default function SettingsNotifications() {
  return (
    <div>
      <nav className={styles.subTabs}>
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={`/settings/notifications/${tab.to}`}
            className={({ isActive }) => `${styles.subTab} ${isActive ? styles.subTabActive : ""}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
