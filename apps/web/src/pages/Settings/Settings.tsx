import { useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import PageShell from "#components/PageShell";
import SearchInput from "#components/SearchInput";
import styles from "./Settings.module.css";
import { SETTINGS_SECTIONS } from "./sections";

export default function Settings() {
  /**
   * Thirty-odd settings pages across four headings, and the only way to reach
   * one whose heading you couldn't guess was to read all four. Filtering the
   * rail is the cheapest fix: it needs no index, and it narrows the thing
   * you're already looking at rather than opening something over the top of it.
   *
   * Local state, not the URL — a filter you typed to find a page is spent the
   * moment you click the page, and putting it in the URL would make it part of
   * every settings link you ever shared.
   */
  const [filter, setFilter] = useState("");

  const sections = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return SETTINGS_SECTIONS;
    return SETTINGS_SECTIONS.map((section) => ({
      ...section,
      // The heading matches too, so "integrations" shows everything under it —
      // people remember which group a setting was in more often than its name.
      links: section.heading.toLowerCase().includes(needle)
        ? section.links
        : section.links.filter((link) => link.label.toLowerCase().includes(needle)),
    })).filter((section) => section.links.length > 0);
  }, [filter]);

  return (
    <PageShell>
      <div className={styles.layout}>
        <nav className={styles.rail} aria-label="Settings sections">
          <div className={styles.railSearch}>
            <SearchInput
              placeholder="Find a setting…"
              ariaLabel="Filter settings"
              value={filter}
              onChange={setFilter}
              fill
            />
          </div>
          {sections.length === 0 ? (
            <p className={styles.railEmpty}>Nothing matches “{filter}”.</p>
          ) : (
            sections.map((section) => (
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
            ))
          )}
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
