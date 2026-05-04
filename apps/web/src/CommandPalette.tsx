import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./CommandPalette.module.css";
import { useGlobalSearch, type SearchHit } from "./useGlobalSearch";

const NAVIGATION: SearchHit[] = [
  { kind: "navigation", id: "nav:stats", title: "Stats", subtitle: "g s", href: "/stats" },
  { kind: "navigation", id: "nav:preview", title: "Preview", href: "/preview" },
  { kind: "navigation", id: "nav:collections", title: "Collections", subtitle: "g c", href: "/collections" },
  { kind: "navigation", id: "nav:media", title: "Media", subtitle: "g m", href: "/media" },
  { kind: "navigation", id: "nav:overlays", title: "Overlays", subtitle: "g o", href: "/overlays" },
  { kind: "navigation", id: "nav:rules", title: "Rules", subtitle: "g r", href: "/rules" },
  { kind: "navigation", id: "nav:jobs", title: "Jobs", subtitle: "g j", href: "/jobs" },
  { kind: "navigation", id: "nav:users", title: "Users", subtitle: "g u", href: "/users" },
  { kind: "navigation", id: "nav:events", title: "Events", subtitle: "g e", href: "/events" },
  { kind: "navigation", id: "nav:settings-plex", title: "Settings: Plex", subtitle: "g p", href: "/settings/plex" },
  { kind: "navigation", id: "nav:settings-ai", title: "Settings: AI", href: "/settings/ai" },
  { kind: "navigation", id: "nav:settings-arrs", title: "Settings: Arrs", href: "/settings/arrs" },
  { kind: "navigation", id: "nav:settings-databases", title: "Settings: Databases", href: "/settings/databases" },
  {
    kind: "navigation",
    id: "nav:settings-notifications",
    title: "Settings: Notifications",
    href: "/settings/notifications",
  },
  { kind: "navigation", id: "nav:settings-health", title: "Settings: Health", href: "/settings/health" },
];

interface Props {
  open: boolean;
  initialQuery?: string;
  onClose: () => void;
}

export default function CommandPalette({ open, initialQuery, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [exiting, setExiting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const { groups, flat, isLoading } = useGlobalSearch(query, { navigation: NAVIGATION, enabled: open });

  const flatHrefs = useMemo(() => flat.map((h) => h.href), [flat]);

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
      const hit = flat[index];
      if (hit) {
        navigate(hit.href);
        close();
      }
    },
    [flat, navigate, close],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery(initialQuery ?? "");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        select(activeIndex);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close, flat.length, activeIndex, select]);

  if (!open && !exiting) return null;

  let renderedIndex = -1;

  return (
    <div className={`${styles.backdrop} ${exiting ? styles.backdropExiting : ""}`} onClick={close}>
      <div className={`${styles.modal} ${exiting ? styles.modalExiting : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.inputWrapper}>
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Search commands, collections, media…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className={styles.results}>
          {flat.length === 0 ? (
            <div className={styles.empty}>{isLoading ? "Searching…" : "No results"}</div>
          ) : (
            groups.map((group) => (
              <div key={group.kind}>
                <div className={styles.sectionLabel}>{group.label}</div>
                {group.hits.map((hit) => {
                  renderedIndex += 1;
                  const idx = renderedIndex;
                  const href = flatHrefs[idx];
                  return (
                    <div
                      key={`${hit.kind}:${hit.id}`}
                      className={`${styles.item} ${idx === activeIndex ? styles.itemActive : ""}`}
                      onClick={() => select(idx)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      title={href}
                    >
                      <div className={styles.itemRow}>
                        <span className={styles.itemTitle}>{hit.title}</span>
                        {hit.subtitle && <span className={styles.itemSubtitle}>{hit.subtitle}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
