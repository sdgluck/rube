import { NavLink } from "react-router-dom";
import styles from "#/styles/shared.module.css";

export type PageTab = {
  to: string;
  label: string;
  /** Row count for this tab. `undefined` renders no count, `0` renders "0". */
  count?: number;
};

/**
 * Sub-navigation between sibling views of one page.
 *
 * Routes rather than local state, so a tab is linkable, survives a reload and
 * gets a back button — the same reasoning that put the rules list's filters in
 * the URL.
 */
export default function PageTabs({ tabs, ariaLabel }: { tabs: PageTab[]; ariaLabel: string }) {
  return (
    <nav className={styles.pageTabs} aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end
          className={({ isActive }) => `${styles.pageTab} ${isActive ? styles.pageTabActive : ""}`}
        >
          {tab.label}
          {tab.count !== undefined && <span className={styles.pageTabCount}>{tab.count}</span>}
        </NavLink>
      ))}
    </nav>
  );
}
