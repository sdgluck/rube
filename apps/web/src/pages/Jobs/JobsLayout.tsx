import { Outlet } from "react-router-dom";
import PageTabs from "#components/PageTabs";
import styles from "./Jobs.module.css";

/**
 * Overview and Schedule: what the jobs are doing, and when they will.
 *
 * Schedule used to be a text box on each job's own page plus a separate
 * Settings → Schedules card for the timezone and window, so nothing showed how
 * the night fitted together — which is how the shipped defaults came to start
 * two syncs outside the window onboarding recommended. One tab beside the
 * dashboard puts the whole night on one screen.
 */
const TABS = [
  { to: "/jobs", label: "Overview" },
  { to: "/jobs/schedule", label: "Schedule" },
];

export default function JobsLayout() {
  return (
    <div className={styles.layout}>
      <div className={styles.layoutTabs}>
        <PageTabs tabs={TABS} ariaLabel="Jobs sections" />
      </div>
      <Outlet />
    </div>
  );
}
