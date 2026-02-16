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
        <NavLink
          to="/settings/radarr"
          className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ""}`}
        >
          Radarr
        </NavLink>
        <NavLink
          to="/settings/sonarr"
          className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ""}`}
        >
          Sonarr
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
