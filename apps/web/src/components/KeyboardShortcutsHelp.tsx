import Modal from "./Modal";
import Kbd, { MOD_KEY } from "./Kbd";
import styles from "./KeyboardShortcutsHelp.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

const GENERAL_SHORTCUTS = [
  { label: "Command palette", keys: [MOD_KEY, "K"] },
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

const GROUPS = [
  { title: "General", rows: GENERAL_SHORTCUTS },
  { title: "Navigation", rows: NAVIGATION_SHORTCUTS },
];

export default function KeyboardShortcutsHelp({ open, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard Shortcuts" size="sm">
      {GROUPS.map((group) => (
        <div key={group.title} className={styles.section}>
          <div className={styles.sectionTitle}>{group.title}</div>
          {group.rows.map((s) => (
            <div key={s.label} className={styles.row}>
              <span className={styles.label}>{s.label}</span>
              <span className={styles.keys}>
                {s.keys.map((k, i) => (
                  <Kbd key={i}>{k}</Kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      ))}
    </Modal>
  );
}
