import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./CommandPalette.module.css";

const COMMANDS = [
  { label: "Stats", path: "/stats", shortcut: "g s" },
  { label: "Collections", path: "/collections", shortcut: "g c" },
  { label: "Media", path: "/media", shortcut: "g m" },
  { label: "Rules", path: "/rules", shortcut: "g r" },
  { label: "Overlays", path: "/overlays", shortcut: "g o" },
  { label: "Users", path: "/users", shortcut: "g u" },
  { label: "Jobs", path: "/jobs", shortcut: "g j" },
  { label: "Events", path: "/events", shortcut: "g e" },
  { label: "Settings: Plex", path: "/settings/plex", shortcut: "g p" },
  { label: "Settings: AI", path: "/settings/ai" },
  { label: "Settings: Arrs", path: "/settings/arrs" },
  { label: "Settings: Databases", path: "/settings/databases" },
  { label: "Settings: Notifications", path: "/settings/notifications" },
  { label: "Settings: Health", path: "/settings/health" },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [exiting, setExiting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const filtered = query ? COMMANDS.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())) : COMMANDS;

  const close = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      setExiting(false);
      setQuery("");
      setActiveIndex(0);
      onClose();
    }, 200);
  }, [onClose]);

  const select = useCallback(
    (index: number) => {
      const cmd = filtered[index];
      if (cmd) {
        navigate(cmd.path);
        close();
      }
    },
    [filtered, navigate, close],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        select(activeIndex);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close, filtered.length, activeIndex, select]);

  if (!open && !exiting) return null;

  return (
    <div className={`${styles.backdrop} ${exiting ? styles.backdropExiting : ""}`} onClick={close}>
      <div className={`${styles.modal} ${exiting ? styles.modalExiting : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.inputWrapper}>
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Type a command..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className={styles.results}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>No results</div>
          ) : (
            filtered.map((cmd, i) => (
              <div
                key={cmd.path}
                className={`${styles.item} ${i === activeIndex ? styles.itemActive : ""}`}
                onClick={() => select(i)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span className={styles.itemLabel}>{cmd.label}</span>
                {cmd.shortcut && <span className={styles.itemShortcut}>{cmd.shortcut}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
