import { ChevronDown } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import styles from "./DropdownButton.module.css";

interface DropdownButtonProps {
  label: string;
  options: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; title?: string }[];
  className?: string;
  disabled?: boolean;
  /** For a trigger with no visible label — a split button's caret. */
  ariaLabel?: string;
}

export default function DropdownButton({ label, options, className, disabled, ariaLabel }: DropdownButtonProps) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setTimeout(() => setVisible(false), 150);
  }, []);

  useEffect(() => {
    if (!visible) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [visible, close]);

  const toggle = () => {
    if (open) {
      close();
    } else {
      setVisible(true);
      setOpen(true);
    }
  };

  return (
    <div className={styles.wrapper} ref={ref}>
      <button
        className={className}
        onClick={toggle}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
        <ChevronDown className={label ? styles.caret : undefined} size={13} strokeWidth={2.5} aria-hidden="true" />
      </button>
      {visible && (
        <div className={`${styles.menu} ${!open ? styles.menuExiting : ""}`}>
          {options.map((opt) => (
            <button
              key={opt.label}
              className={`${styles.menuItem} ${opt.danger ? styles.menuItemDanger : ""}`}
              disabled={opt.disabled}
              title={opt.title}
              onClick={() => {
                close();
                opt.onClick();
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
