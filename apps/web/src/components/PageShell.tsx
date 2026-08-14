import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageActions } from "#layout/AppBar";
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

/**
 * The `← Parent / This record` link that opens a drill-in route. It carries the
 * record's name because the page no longer has a heading to put it in.
 */
export function BackLink({
  to,
  parent,
  onBack,
  children,
}: {
  to: string;
  parent?: ReactNode;
  /** Go back through history instead of to `to` — the drill-in came from a
   *  filtered list and `to` would throw the filters away. */
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <div className={styles.backRow}>
      {onBack ? (
        <a
          href={to}
          className={styles.backLink}
          onClick={(e) => {
            e.preventDefault();
            onBack();
          }}
        >
          <span aria-hidden="true">←</span>
          {parent ?? children}
        </a>
      ) : (
        <Link to={to} className={styles.backLink}>
          <span aria-hidden="true">←</span>
          {parent ?? children}
        </Link>
      )}
      {parent != null && (
        <>
          <span className={styles.backSep} aria-hidden="true">
            /
          </span>
          <span className={styles.backCurrent}>{children}</span>
        </>
      )}
    </div>
  );
}

type PageShellProps = {
  /** Total the page is showing, in mono beside the breadcrumb. */
  count?: ReactNode;
  /** A <StatusChip>, or anything else that belongs beside the count. */
  chip?: ReactNode;
  /** Ghost → secondary → primary, left to right. */
  actions?: ReactNode;
  /** Drops the body's bottom gutter for pages that fill the viewport. */
  flush?: boolean;
  bodyClassName?: string;
  children: ReactNode;
};

/**
 * The frame every page adopts. `page-shell` is a global marker class: App.css
 * uses it to hand the page gutter over from `.content` to this component.
 *
 * There is no page header: the app bar names the route once, for every page,
 * and a page's counts, chips and buttons are portalled up into it.
 */
export default function PageShell({ count, chip, actions, flush = false, bodyClassName, children }: PageShellProps) {
  const bodyClasses = [styles.body, flush ? styles.bodyFlush : "", bodyClassName ?? ""].filter(Boolean).join(" ");
  const shellClasses = ["page-shell", styles.shell, flush ? `page-shell-flush ${styles.shellFlush}` : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClasses}>
      {(count != null || chip != null) && (
        <PageActions slot="meta">
          {count != null && <span className={styles.count}>{count}</span>}
          {chip}
        </PageActions>
      )}
      {actions != null && <PageActions>{actions}</PageActions>}
      <div className={bodyClasses}>{children}</div>
    </div>
  );
}
