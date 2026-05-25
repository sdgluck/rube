import { NavLink, Outlet } from "react-router-dom";
import styles from "./Settings.module.css";

const SECTIONS: { heading: string; links: { to: string; label: string }[] }[] = [
  {
    heading: "Integrations",
    links: [
      { to: "/settings/plex", label: "Plex" },
      { to: "/settings/ai", label: "AI" },
      { to: "/settings/arrs", label: "Arrs" },
      { to: "/settings/databases", label: "Databases" },
    ],
  },
  {
    heading: "Automation",
    links: [
      { to: "/settings/personalization", label: "Personalization" },
      { to: "/settings/preferences", label: "User Preferences" },
      { to: "/settings/notifications", label: "Notifications" },
      { to: "/settings/posters", label: "Posters" },
    ],
  },
  {
    heading: "Tools",
    links: [
      { to: "/settings/migrate", label: "Migrate" },
      { to: "/settings/maintenance", label: "Maintenance" },
      { to: "/settings/health", label: "Health" },
      { to: "/settings/stress-test", label: "Stress Test" },
    ],
  },
  {
    heading: "About",
    links: [
      { to: "/settings/credits", label: "Credits" },
      { to: "/settings/about", label: "About" },
    ],
  },
];

export default function Settings() {
  return (
    <div>
      <h2 className={styles.heading}>Settings</h2>
      <div className={styles.layout}>
        <aside className={styles.rail}>
          {SECTIONS.map((section) => (
            <div key={section.heading} className={styles.railSection}>
              <div className={styles.railHeading}>{section.heading}</div>
              {section.links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) => `${styles.railLink} ${isActive ? styles.railLinkActive : ""}`}
                >
                  {link.label}
                </NavLink>
              ))}
            </div>
          ))}
        </aside>
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
