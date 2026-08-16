import { forwardRef, useRef, type ChangeEvent } from "react";
import styles from "./SearchInput.module.css";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Placeholder and, unless `ariaLabel` overrides it, the accessible name. */
  placeholder: string;
  ariaLabel?: string;
  /** Opt out of the fixed width where the field shares a row it should flex in. */
  grow?: boolean;
  /** Opt out of the fixed width where the field sits in a narrower column. */
  fill?: boolean;
}

/**
 * The search field above a table.
 *
 * One component rather than six copies of an input: the pages had drifted to
 * three different widths and Rules had reimplemented the magnifier glyph as an
 * inline SVG, so the same control looked different depending which page you
 * were on. Width lives here now, and a clear button comes with it.
 */
const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onChange, placeholder, ariaLabel, grow = false, fill = false },
  ref,
) {
  const fallbackRef = useRef<HTMLInputElement>(null);

  function clear() {
    onChange("");
    // Focus goes back to the field, not to the button that just vanished —
    // clearing a search is nearly always a prelude to typing a different one.
    const el = typeof ref === "function" ? fallbackRef.current : (ref?.current ?? fallbackRef.current);
    el?.focus();
  }

  return (
    <div className={`${styles.wrap} ${grow ? styles.grow : ""} ${fill ? styles.fill : ""}`}>
      <input
        ref={(el) => {
          fallbackRef.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        type="text"
        className={styles.input}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder.replace(/…$/, "")}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        // Escape clears rather than bubbling — inside a modal it would
        // otherwise close the thing the user is searching in.
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            clear();
          }
        }}
      />
      {value && (
        <button type="button" className={styles.clear} onClick={clear} aria-label="Clear search" tabIndex={-1}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
});

export default SearchInput;
