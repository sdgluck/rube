import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import styles from "./List.module.css";

type ListRowProps = {
  /** Leading artwork or an icon tile. */
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Trailing value text (a count, a state) — drawn before the chevron. */
  value?: ReactNode;
  /** Trailing control (a switch, a button) in place of a value and chevron. */
  trailing?: ReactNode;
  /** A link pushes a screen and gets a chevron. */
  to?: string;
  onClick?: () => void;
  destructive?: boolean;
  className?: string;
};

/**
 * One row of a `ListSection`: leading media, title and subtitle, then a
 * value and chevron, or a control. A row with `to` is a link that pushes a
 * screen; with `onClick` it is a button; with neither it just shows a value.
 * Rows are at least 44px tall, a comfortable touch target at any width.
 */
export default function ListRow({
  leading,
  title,
  subtitle,
  value,
  trailing,
  to,
  onClick,
  destructive,
  className,
}: ListRowProps) {
  const body = (
    <>
      {leading && <span className={styles.leading}>{leading}</span>}
      <span className={styles.text}>
        <span className={`${styles.title} ${destructive ? styles.destructive : ""}`}>{title}</span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </span>
      {value != null && value !== false && <span className={styles.value}>{value}</span>}
      {trailing}
      {to && !trailing && <ChevronRight className={styles.chevron} size="1.8rem" strokeWidth={2.2} aria-hidden />}
    </>
  );
  const cls = `${styles.row} ${to || onClick ? styles.interactive : ""} ${className ?? ""}`;
  if (to) {
    return (
      <Link to={to} className={cls} role="listitem">
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} role="listitem">
        {body}
      </button>
    );
  }
  return (
    <div className={cls} role="listitem">
      {body}
    </div>
  );
}

/** A small rounded icon tile for a row's leading slot. */
export function RowIcon({
  children,
  tone = "accent",
}: {
  children: ReactNode;
  tone?: "accent" | "neutral" | "warn" | "danger";
}) {
  return <span className={`${styles.icon} ${styles[`icon_${tone}`]}`}>{children}</span>;
}
