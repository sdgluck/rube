import type { ReactNode } from "react";
import styles from "./BrowserFrame.module.css";

/** A faux browser chrome wrapper that makes raw screenshots read as a real app. */
export default function BrowserFrame({ url = "tinkerbell.local", children }: { url?: string; children: ReactNode }) {
  return (
    <div className={styles.frame}>
      <div className={styles.bar}>
        <span className={styles.dot} style={{ background: "#ff5f57" }} />
        <span className={styles.dot} style={{ background: "#febc2e" }} />
        <span className={styles.dot} style={{ background: "#28c840" }} />
        <span className={styles.url}>{url}</span>
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
