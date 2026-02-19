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
          *arrs
        </NavLink>
        <NavLink
          to="/settings/critics"
          className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ""}`}
        >
          Critics
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
