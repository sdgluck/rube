import { NavLink, Outlet } from "react-router-dom";
import styles from "./Settings.module.css";

export default function SettingsNotifications() {
  return (
    <div>
      <nav className={styles.subTabs}>
        <NavLink
          to="/settings/notifications/pushover"
          className={({ isActive }) => `${styles.subTab} ${isActive ? styles.subTabActive : ""}`}
        >
          Pushover
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
