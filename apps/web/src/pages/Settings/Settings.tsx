import { NavLink, Outlet } from "react-router-dom";
import PageShell from "#components/PageShell";
import styles from "./Settings.module.css";
import { SETTINGS_SECTIONS } from "./sections";

export default function Settings() {
  return (
    <PageShell title="Settings" subtitle="How Tinkerbell connects to Plex and everything around it.">
      <div className={styles.layout}>
        <nav className={styles.rail} aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((section) => (
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
        </nav>
        {/* Not <main> — App already renders one, and a document may only have
            a single main landmark. */}
        <div className={styles.main}>
          <Outlet />
        </div>
      </div>
    </PageShell>
  );
}
