import { NavLink, Outlet } from "react-router-dom";
import styles from "./Settings.module.css";

export default function Settings() {
  return (
    <div>
      <h2 className={styles.heading}>Settings</h2>
      <nav className={styles.tabs}>
        <NavLink to="/settings/plex" className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ""}`}>
          Plex
        </NavLink>
        <NavLink to="/settings/ai" className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ""}`}>
          AI
        </NavLink>
        <NavLink to="/settings/arrs" className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ""}`}>
          Arrs
        </NavLink>
        <NavLink
          to="/settings/databases"
          className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ""}`}
        >
          Databases
        </NavLink>
        <NavLink
          to="/settings/notifications"
          className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ""}`}
        >
          Notifications
        </NavLink>
        <NavLink
          to="/settings/posters"
          className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ""}`}
        >
          Posters
        </NavLink>
        <NavLink
          to="/settings/health"
          className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ""}`}
        >
          Health
        </NavLink>
        <NavLink
          to="/settings/stress-test"
          className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ""}`}
        >
          Stress Test
        </NavLink>
        <NavLink to="/settings/about" className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ""}`}>
          About
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
