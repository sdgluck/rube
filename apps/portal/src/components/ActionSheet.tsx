import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { pushOverlay } from "../lib/overlay-history.ts";

export type SheetAction = { label: string; onSelect: () => void; danger?: boolean };

/**
 * The portal's action sheet: a grouped card of choices over a separate
 * Cancel on iOS, a bottom sheet of rows on Android (portal.css). The admin app
 * has its own; the portal can't import it. Back closes it.
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
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    return pushOverlay(() => closeRef.current());
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()} role="presentation">
      <div className="action-sheet" role="menu" aria-label={title}>
        <span className="sheet-grabber" aria-hidden />
        <div className="action-group">
          {title && <div className="action-title">{title}</div>}
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              className={`action-item ${a.danger ? "danger" : ""}`}
              onClick={() => {
                onClose();
                a.onSelect();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
        <button type="button" className="action-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  );
}
