import { ChevronDown } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import styles from "./DropdownButton.module.css";

interface DropdownButtonProps {
  label: string;
  options: { label: string; onClick: () => void; disabled?: boolean }[];
  className?: string;
  disabled?: boolean;
}

export default function DropdownButton({ label, options, className, disabled }: DropdownButtonProps) {
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
      <button className={className} onClick={toggle} disabled={disabled}>
        {label}
        <ChevronDown className={styles.caret} size={13} strokeWidth={2.5} aria-hidden="true" />
      </button>
      {visible && (
        <div className={`${styles.menu} ${!open ? styles.menuExiting : ""}`}>
          {options.map((opt) => (
            <button
              key={opt.label}
              className={styles.menuItem}
              disabled={opt.disabled}
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
