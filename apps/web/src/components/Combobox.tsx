import { ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";
import { comboView, type ComboOption } from "#lib/combobox";
import controls from "#/styles/controls.module.css";
import styles from "./Combobox.module.css";

interface ComboboxProps {
  /** The input's id, for a `<label htmlFor>`. */
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  /** Plural of what the options are, for the "Show all 4 models" row. */
  noun?: string;
}

/**
 * A text field that suggests, rather than restricts: anything typed is kept
 * as the value, and the list is only help choosing one.
 *
 * Replaces a `<datalist>`, which filtered by the field's whole value — with a
 * model already chosen the list offered only that model. Here the list opened
 * from the field or the chevron shows everything, typing filters it, and a
 * filtered list always ends in "Show all", so the other options are never a
 * cleared field away. See `comboView` for the rules.
 */
export default function Combobox({ id, value, onChange, options, placeholder, noun = "options" }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  /** Typed since the list opened: only then does the field's text filter it. */
  const [typed, setTyped] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const view = comboView(options, typed ? value : "", showAll);
  // The "Show all" row is the last keyboard stop when the filter hid anything.
  const stops = view.options.length + (view.hidden > 0 ? 1 : 0);

  function openList(all: boolean) {
    setOpen(true);
    setTyped(false);
    setShowAll(all);
    setActive(-1);
  }

  function choose(next: string) {
    onChange(next);
    setOpen(false);
  }

  function expand() {
    setShowAll(true);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return openList(false);
      if (stops === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + stops) % stops);
    } else if (e.key === "Enter" && open && active >= 0) {
      e.preventDefault();
      if (active < view.options.length) choose(view.options[active].value);
      else expand();
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  }

  const activeId = open && active >= 0 ? `${listId}-${active}` : undefined;

  return (
    <div className={styles.wrapper}>
      <div className={styles.row}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          className={styles.input}
          value={value}
          placeholder={placeholder}
          onFocus={() => openList(false)}
          onClick={() => !open && openList(false)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setTyped(true);
            setShowAll(false);
            setActive(-1);
          }}
        />
        <button
          type="button"
          className={`${controls.btn} ${controls.btnSecondary} ${controls.btnIcon}`}
          aria-label={open ? `Hide ${noun}` : `Show all ${noun}`}
          tabIndex={-1}
          // Keep focus in the field: a blur would close the list this opens.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (open && (!typed || showAll)) setOpen(false);
            else openList(true);
            inputRef.current?.focus();
          }}
        >
          <ChevronDown size="1.5rem" aria-hidden="true" />
        </button>
      </div>

      {open && (options.length > 0 || view.hidden > 0) && (
        <div className={styles.menu} id={listId} role="listbox">
          {view.options.length === 0 && (
            <p className={styles.empty}>
              No {noun} match &ldquo;{value.trim()}&rdquo; — it&rsquo;s used as typed.
            </p>
          )}
          {view.options.map((o, i) => (
            <div
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={i === active ? styles.optionActive : o.value === value ? styles.optionChosen : styles.option}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(o.value)}
            >
              <span className={styles.optionValue}>{o.value}</span>
              {o.label && o.label !== o.value && <span className={styles.optionLabel}>{o.label}</span>}
            </div>
          ))}
          {view.hidden > 0 && (
            <div
              id={`${listId}-${view.options.length}`}
              role="option"
              aria-selected={false}
              className={active === view.options.length ? styles.showAllActive : styles.showAll}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(view.options.length)}
              onClick={expand}
            >
              Show all {options.length} {noun}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
