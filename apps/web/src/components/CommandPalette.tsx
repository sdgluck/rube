import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "./Modal";
import styles from "./CommandPalette.module.css";
import { useGlobalSearch, type SearchHit } from "#hooks/useGlobalSearch";
import { NAV_SECTIONS } from "#/nav";
import { SETTINGS_LINKS } from "#pages/Settings/sections";

/** `g`-sequence shortcuts, shown as a hint on the matching palette row. */
const GO_HINTS: Record<string, string> = {
  "/stats": "g s",
  "/collections": "g c",
  "/media": "g m",
  "/overlays": "g o",
  "/rules": "g r",
  "/jobs": "g j",
  "/users": "g u",
  "/events": "g e",
  "/settings/plex": "g p",
};

/**
 * Every navigable destination, derived from the sidebar and settings rail so
 * the palette can't drift out of date. It previously hardcoded 15 entries and
 * was missing changelog, maintenance, portal, posters, migrate, about and
 * credits.
 */
const NAVIGATION: SearchHit[] = [
  ...NAV_SECTIONS.flatMap((section) =>
    section.items.map((item) => ({
      kind: "navigation" as const,
      id: `nav:${item.to}`,
      title: item.label,
      subtitle: GO_HINTS[item.to],
      href: item.to,
    })),
  ),
  ...SETTINGS_LINKS.map((link) => ({
    kind: "navigation" as const,
    id: `nav:${link.to}`,
    title: `Settings: ${link.label}`,
    subtitle: GO_HINTS[link.to],
    href: link.to,
  })),
  { kind: "navigation", id: "nav:/settings/changelog", title: "Changelog", href: "/settings/changelog" },
  { kind: "navigation", id: "nav:/cleanup/rules", title: "Cleanup rules", href: "/cleanup/rules" },
];

interface Props {
  open: boolean;
  initialQuery?: string;
  onClose: () => void;
}

export default function CommandPalette({ open, initialQuery, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { groups, flat, isLoading } = useGlobalSearch(query, { navigation: NAVIGATION, enabled: open });

  const flatHrefs = useMemo(() => flat.map((h) => h.href), [flat]);

  const close = useCallback(() => {
    setQuery("");
    setActiveIndex(0);
    onClose();
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
      // Modal focuses its first focusable element; that's this input, but the
      // initial query should also be selected so typing replaces it.
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [open, initialQuery]);

  // Keep the keyboard-selected row visible. Without this, arrowing past the
  // eighth result walked the selection off the bottom of the list.
  useEffect(() => {
    if (!open) return;
    resultsRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
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
  }, [open, flat.length, activeIndex, select]);

  let renderedIndex = -1;
  const activeId = `palette-option-${activeIndex}`;

  return (
    <Modal open={open} onClose={close} title="Search" hideTitle size="md" hideCloseButton className={styles.panel}>
      <div className={styles.inputWrapper}>
        <input
          ref={inputRef}
          className={styles.queryInput}
          placeholder="Search commands, collections, media…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          role="combobox"
          aria-expanded
          aria-controls="palette-results"
          aria-activedescendant={flat.length > 0 ? activeId : undefined}
          aria-autocomplete="list"
          aria-label="Search commands, collections and media"
        />
      </div>
      <div className={styles.results} ref={resultsRef} id="palette-results" role="listbox" aria-label="Results">
        {flat.length === 0 ? (
          <div className={styles.empty}>{isLoading ? "Searching…" : "No results"}</div>
        ) : (
          groups.map((group) => (
            <div key={group.kind} role="group" aria-label={group.label}>
              <div className={styles.sectionLabel}>{group.label}</div>
              {group.hits.map((hit) => {
                renderedIndex += 1;
                const idx = renderedIndex;
                return (
                  <div
                    key={`${hit.kind}:${hit.id}`}
                    id={`palette-option-${idx}`}
                    data-index={idx}
                    role="option"
                    aria-selected={idx === activeIndex}
                    className={`${styles.item} ${idx === activeIndex ? styles.itemActive : ""}`}
                    onClick={() => select(idx)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    title={flatHrefs[idx]}
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
      <div className={styles.footer} aria-hidden="true">
        ↑↓ move · ↵ open · esc close
      </div>
    </Modal>
  );
}
