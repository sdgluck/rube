import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { pushOverlay } from "@tinkerbell/native-client";
import { useSheetDrag } from "#hooks/useSheetDrag";
import styles from "./ActionSheet.module.css";

export type SheetAction = {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

const EXIT_MS = 200;

/**
 * A phone's answer to a dropdown menu.
 *
 * A popover anchored to a 26px "…" is a desktop idiom: on a phone it lands
 * under the thumb that opened it, half off-screen, and closes on the first
 * scroll. Native apps raise an action sheet instead — iOS as a grouped card
 * of choices with a separate Cancel, Android as a bottom sheet of rows. Both
 * are drawn here from one component; the platform stylesheet picks the look.
 *
 * Used by `DropdownButton`, `RowActions` and the header's overflow on phones.
 * Back closes it, and it can be dragged away like any other sheet.
 */
export default function ActionSheet({
  open,
  onClose,
  title,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  actions: SheetAction[];
}) {
  const [exiting, setExiting] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(
    (then?: () => void) => {
      setExiting(true);
      window.setTimeout(() => {
        setExiting(false);
        onClose();
        then?.();
      }, EXIT_MS);
    },
    [onClose],
  );

  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    return pushOverlay(() => closeRef.current());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useSheetDrag(panelRef, { enabled: open && !exiting, canDismiss: true, onDismiss: onClose });

  if (!open && !exiting) return null;
  const regular = actions.filter((a) => !a.danger);
  const danger = actions.filter((a) => a.danger);

  return createPortal(
    <div
      className={`${styles.backdrop} ${exiting ? styles.backdropExiting : ""}`}
      onClick={(e) => e.target === e.currentTarget && close()}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={`${styles.sheet} ${exiting ? styles.sheetExiting : ""}`}
        role="menu"
        aria-label={title}
      >
        <span className={styles.grabber} aria-hidden />
        <div className={styles.group}>
          {title && <div className={styles.title}>{title}</div>}
          {[...regular, ...danger].map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              className={`${styles.action} ${action.danger ? styles.actionDanger : ""}`}
              disabled={action.disabled}
              onClick={() => {
                // The choice runs after the sheet has gone, so anything it
                // opens (a confirm, another sheet) isn't stacked under it.
                close(action.onSelect);
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
        <button type="button" className={styles.cancel} onClick={() => close()}>
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  );
}
