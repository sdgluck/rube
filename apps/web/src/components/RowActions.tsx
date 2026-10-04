import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./RowActions.module.css";

export type RowAction = {
  label: string;
  onSelect: () => void;
  icon?: LucideIcon;
  /** Renders inline as an icon button instead of inside the overflow menu. */
  inline?: boolean;
  /** The row's main verb — inline, in the accent colour. */
  primary?: boolean;
  /** Inline button in a pressed state (a toggle, like Preview). */
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** Tooltip / accessible name; falls back to `label`. */
  title?: string;
};

/**
 * The one way a list row offers actions. Rows are clickable, and a strip of
 * seven text buttons made every row a minefield — so only the main verb stays
 * inline and everything else, destructive things especially, lives behind "…".
 *
 * Clicks are stopped here: the row underneath navigates.
 */
export default function RowActions({ actions, label = "Row actions" }: { actions: RowAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const inline = actions.filter((a) => a.inline);
  const overflow = actions.filter((a) => !a.inline);
  const danger = overflow.filter((a) => a.danger);
  const regular = overflow.filter((a) => !a.danger);

  // The menu is portalled and fixed: a row lives inside a horizontally
  // scrolling table wrapper, which would clip an absolutely positioned popover.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const width = menuRef.current?.offsetWidth ?? 168;
    const height = menuRef.current?.offsetHeight ?? 0;
    const flipUp = rect.bottom + height + 8 > window.innerHeight;
    setPos({
      top: flipUp ? Math.max(8, rect.top - height - 4) : rect.bottom + 4,
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || buttonRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // Any scroll moves the row out from under a fixed menu.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (actions.length === 0) return null;

  const renderItem = (action: RowAction) => {
    const Icon = action.icon;
    return (
      <button
        key={action.label}
        type="button"
        className={`${styles.item} ${action.danger ? styles.itemDanger : ""}`}
        disabled={action.disabled}
        title={action.title}
        onClick={() => {
          setOpen(false);
          action.onSelect();
        }}
      >
        {Icon && (
          <span className={styles.itemIcon}>
            <Icon size={14} strokeWidth={2} />
          </span>
        )}
        {action.label}
      </button>
    );
  };

  return (
    <div
      className={styles.wrap}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="presentation"
    >
      {inline.map((action) => {
        const Icon = action.icon;
        const classes = [
          styles.trigger,
          action.primary ? styles.triggerPrimary : "",
          action.active ? styles.triggerActive : "",
          action.danger ? styles.triggerDanger : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={action.label}
            type="button"
            className={classes}
            disabled={action.disabled}
            title={action.title ?? action.label}
            aria-label={action.title ?? action.label}
            onClick={action.onSelect}
          >
            {Icon ? <Icon size={15} strokeWidth={2} /> : action.label}
          </button>
        );
      })}

      {overflow.length > 0 && (
        <>
          <button
            ref={buttonRef}
            type="button"
            className={`${styles.trigger} ${open ? styles.triggerActive : ""}`}
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={open}
            title={label}
            onClick={() => setOpen((v) => !v)}
          >
            <MoreHorizontal size={16} strokeWidth={2} />
          </button>
          {open &&
            createPortal(
              <div
                ref={menuRef}
                className={styles.menu}
                role="menu"
                style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
              >
                {regular.map(renderItem)}
                {danger.length > 0 && regular.length > 0 && <div className={styles.separator} />}
                {danger.map(renderItem)}
              </div>,
              document.body,
            )}
        </>
      )}
    </div>
  );
}
