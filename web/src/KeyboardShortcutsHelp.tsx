import { useState, useEffect, useCallback } from "react";
import styles from "./KeyboardShortcutsHelp.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

const GENERAL_SHORTCUTS = [
  { label: "Command palette", keys: ["\u2318", "K"] },
  { label: "Focus search", keys: ["/"] },
  { label: "Show shortcuts", keys: ["?"] },
];

const NAVIGATION_SHORTCUTS = [
  { label: "Go to Stats", keys: ["g", "s"] },
  { label: "Go to Collections", keys: ["g", "c"] },
  { label: "Go to Media", keys: ["g", "m"] },
  { label: "Go to Rules", keys: ["g", "r"] },
  { label: "Go to Overlays", keys: ["g", "o"] },
  { label: "Go to Users", keys: ["g", "u"] },
  { label: "Go to Jobs", keys: ["g", "j"] },
  { label: "Go to Events", keys: ["g", "e"] },
  { label: "Go to Settings", keys: ["g", "p"] },
];

export default function KeyboardShortcutsHelp({ open, onClose }: Props) {
  const [exiting, setExiting] = useState(false);

  const close = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      setExiting(false);
      onClose();
    }, 200);
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  if (!open && !exiting) return null;

  return (
    <div className={`${styles.backdrop} ${exiting ? styles.backdropExiting : ""}`} onClick={close}>
      <div className={`${styles.modal} ${exiting ? styles.modalExiting : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>Keyboard Shortcuts</div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>General</div>
          {GENERAL_SHORTCUTS.map((s) => (
            <div key={s.label} className={styles.row}>
              <span className={styles.label}>{s.label}</span>
              <span className={styles.keys}>
                {s.keys.map((k, i) => (
                  <span key={i} className={styles.key}>
                    {k}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Navigation</div>
          {NAVIGATION_SHORTCUTS.map((s) => (
            <div key={s.label} className={styles.row}>
              <span className={styles.label}>{s.label}</span>
              <span className={styles.keys}>
                {s.keys.map((k, i) => (
                  <span key={i} className={styles.key}>
                    {k}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
