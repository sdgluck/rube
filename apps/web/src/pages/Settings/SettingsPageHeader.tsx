import type { ReactNode } from "react";
import styles from "./Settings.module.css";

/**
 * Standard header for every settings page: the pane's title, and optionally a
 * fact about it (the version, a count) set beside the title in mono.
 *
 * There is deliberately no description slot. Every pane used to carry a line of
 * prose under its title restating what the controls below already said, which
 * pushed the first real control down the fold on short viewports.
 */
export default function SettingsPageHeader({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <header className={styles.pageHeader}>
      <h3 className={styles.pageTitle}>{title}</h3>
      {meta != null && <span className={styles.pageMeta}>{meta}</span>}
    </header>
  );
}
