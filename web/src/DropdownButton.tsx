import { useState, useRef, useEffect } from "react";
import styles from "./DropdownButton.module.css";

interface DropdownButtonProps {
  label: string;
  options: { label: string; onClick: () => void; disabled?: boolean }[];
  className?: string;
  disabled?: boolean;
}

export default function DropdownButton({ label, options, className, disabled }: DropdownButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className={styles.wrapper} ref={ref}>
      <button className={className} onClick={() => setOpen((v) => !v)} disabled={disabled}>
        {label} <span className={styles.caret}>&#9662;</span>
      </button>
      {open && (
        <div className={styles.menu}>
          {options.map((opt) => (
            <button
              key={opt.label}
              className={styles.menuItem}
              disabled={opt.disabled}
              onClick={() => {
                setOpen(false);
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
