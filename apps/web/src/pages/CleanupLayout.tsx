import { Outlet } from "react-router-dom";
import PageTabs from "#components/PageTabs";
import styles from "./Cleanup.module.css";

/**
 * The two halves of cleanup: what the rules have matched so far, and the rules
 * themselves.
 *
 * They were split off the Rules page because a cleanup rule and a collection
 * rule share a table but not a meaning — "Status" is collections built for one
 * and items queued for the other. Putting the rules beside their queue also
 * matches how they're used: you edit a streak or a mode, then look at what
 * that did to the queue.
 */
const TABS = [
  { to: "/cleanup", label: "Queue" },
  { to: "/cleanup/rules", label: "Rules" },
  // Protection is a third thing, not a filter on the queue: most of what it
  // covers has never been matched by a rule and so has never appeared there.
  { to: "/cleanup/protected", label: "Protected" },
];

export default function CleanupLayout() {
  return (
    <div className={styles.layout}>
      <div className={styles.layoutTabs}>
        <PageTabs tabs={TABS} ariaLabel="Cleanup sections" />
      </div>
      <Outlet />
    </div>
  );
}
