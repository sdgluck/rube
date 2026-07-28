import type { ReactNode } from "react";
import styles from "./Banner.module.css";

type Variant = "info" | "warn" | "error" | "ok";

interface BannerProps {
  variant?: Variant;
  /** Optional leading status dot — for banners reporting on/off state. */
  dot?: boolean;
  children: ReactNode;
  /** Buttons or links, right-aligned. */
  actions?: ReactNode;
}

/**
 * Page-level inline notice. Replaces three separate idioms: FeatureStatusBanner
 * reaching into the Jobs page stylesheet, MigrationBanner styled entirely with
 * inline styles including its own copies of the button styles, and
 * UnsavedBanner's bespoke module.
 */
export default function Banner({ variant = "info", dot = false, children, actions }: BannerProps) {
  return (
    <div className={`${styles.banner} ${styles[variant]}`} role={variant === "error" ? "alert" : undefined}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      <div className={styles.content}>{children}</div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
