import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import styles from "./SearchSelect.module.css";

export interface SearchSelectOption {
  value: string;
  label: string;
  /** A second line, also matched by the search. */
  detail?: string;
}

interface SearchSelectProps {
  /** The trigger's id, for a `<label htmlFor>`. */
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchSelectOption[];
  /** Accessible name. */
  ariaLabel: string;
  /** Added to the trigger, which already looks like a small `select`. */
  className?: string;
}

/**
 * A single-choice select you can type into to find an option.
 *
 * For lists too long to scroll: a native `<select>` of a server's two hundred
 * Plex users meant reading down the whole list for one name. `Combobox` is the
 * other typeahead here, but it keeps whatever is typed as the value — right for
 * a model name, wrong for a user id, where only a listed option is valid.
 *
 * The trigger is styled as the shared `select` so it sits beside real ones
 * without looking like a different control. The same popover serves a phone.
 */
export default function SearchSelect({ id, value, onChange, options, ariaLabel, className }: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || (o.detail?.toLowerCase().includes(q) ?? false));
  }, [options, query]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const openMenu = () => {
    setQuery("");
    // Start on the current choice, so Enter straight away changes nothing.
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, close]);

  // Keep the keyboard's row in view as it moves through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const choose = (next: string) => {
    onChange(next);
    close(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (shown.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + shown.length) % shown.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = shown[active];
      if (opt) choose(opt.value);
    } else if (e.key === "Escape") {
      // Swallowed, as in MultiSelect: a modal behind this also closes on Escape.
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  };

  const label = options.find((o) => o.value === value)?.label ?? "";

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`${styles.trigger} ${className ?? ""}`}
        onClick={() => (open ? close(false) : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${ariaLabel}: ${label}`}
      >
        {label}
      </button>
      {open && (
        <div className={styles.menu} onKeyDown={onKeyDown}>
          <input
            className={styles.filter}
            type="search"
            placeholder="Search"
            value={query}
            autoFocus
            autoComplete="off"
            aria-label={`Search ${ariaLabel}`}
            aria-controls={listId}
            aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
          />
          <div className={styles.list} id={listId} role="listbox" aria-label={ariaLabel} ref={listRef}>
            {shown.map((o, i) => (
              <button
                key={o.value}
                id={`${listId}-${i}`}
                data-index={i}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={o.value === value}
                className={`${styles.option} ${i === active ? styles.optionActive : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o.value)}
              >
                <span className={styles.optionLabel}>{o.label}</span>
                {o.detail && <span className={styles.optionDetail}>{o.detail}</span>}
              </button>
            ))}
            {shown.length === 0 && <p className={styles.empty}>Nothing matches “{query.trim()}”.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
