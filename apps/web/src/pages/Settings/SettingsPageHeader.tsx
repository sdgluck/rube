import type { ReactNode } from "react";
import styles from "./Settings.module.css";

/**
 * Standard header for every settings page: a consistent title + optional
 * one-line description. Keeps information hierarchy uniform across pages.
 */
export default function SettingsPageHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <header className={styles.pageHeader}>
      <h3 className={styles.pageTitle}>{title}</h3>
      {description && <p className={styles.pageDescription}>{description}</p>}
    </header>
  );
}
