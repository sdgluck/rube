import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import styles from "./PageShell.module.css";

export type StatusChipTone = "advisory" | "running" | "error" | "ok";

const CHIP_TONE: Record<StatusChipTone, string> = {
  advisory: styles.chipAdvisory,
  running: styles.chipRunning,
  error: styles.chipError,
  ok: styles.chipOk,
};

/** Live page state — running, degraded, an error count. Never a description. */
export function StatusChip({
  tone = "advisory",
  dot = false,
  children,
}: {
  tone?: StatusChipTone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`${styles.chip} ${CHIP_TONE[tone]}`}>
      {dot && <span className={styles.chipDot} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** The mono `← Parent` link that opens the body of a drill-in route. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={styles.backLink}>
      <span aria-hidden="true">←</span>
      {children}
    </Link>
  );
}

type PageShellProps = {
  title: ReactNode;
  /** Total the page is showing, in mono beside the title. */
  count?: ReactNode;
  /** A <StatusChip>, or anything else that belongs beside the count. */
  chip?: ReactNode;
  /** Ghost → secondary → primary, left to right. */
  actions?: ReactNode;
  /** What the page shows. Not live state, not the page's own structure. */
  subtitle?: ReactNode;
  /** Drops the body's bottom gutter for pages that fill the viewport. */
  flush?: boolean;
  bodyClassName?: string;
  children: ReactNode;
};

/**
 * The frame every page adopts. `page-shell` is a global marker class: App.css
 * uses it to hand the page gutter over from `.content` to this component.
 */
export default function PageShell({
  title,
  count,
  chip,
  actions,
  subtitle,
  flush = false,
  bodyClassName,
  children,
}: PageShellProps) {
  const bodyClasses = [styles.body, flush ? styles.bodyFlush : "", bodyClassName ?? ""].filter(Boolean).join(" ");

  return (
    <div className={`page-shell ${styles.shell}`}>
      <header className={styles.header}>
        <div className={styles.row}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>{title}</h1>
            {count != null && <span className={styles.count}>{count}</span>}
          </div>
          {chip}
          <div className={styles.spacer} />
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </header>
      <div className={bodyClasses}>{children}</div>
    </div>
  );
}
