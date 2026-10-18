import type { ReactNode } from "react";
import styles from "./List.module.css";

/**
 * A group of rows with an optional header and footer, drawn as a plain
 * bordered card — Problems' kinds and the narrow-screen Settings index.
 */
export default function ListSection({
  title,
  footer,
  children,
  className,
}: {
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${styles.section} ${className ?? ""}`}>
      {title && <h2 className={styles.sectionTitle}>{title}</h2>}
      <div className={styles.group} role="list">
        {children}
      </div>
      {footer && <p className={styles.sectionFooter}>{footer}</p>}
    </section>
  );
}
