import { NavLink, Outlet } from "react-router-dom";
import SettingsPageHeader from "../SettingsPageHeader";
import styles from "../Settings.module.css";

const TABS = [
  { to: "address", label: "Address" },
  { to: "personalization", label: "Personalization" },
  { to: "appearance", label: "Appearance" },
  { to: "preroll", label: "Preroll" },
];

export default function SettingsPortal() {
  return (
    <div>
      <SettingsPageHeader title="Portal" />
      <nav className={styles.subTabs} aria-label="Portal sections">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={`/settings/portal/${tab.to}`}
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
