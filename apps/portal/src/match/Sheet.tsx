import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { pushOverlay } from "../lib/overlay-history.ts";

/**
 * A centred card on a desktop and a bottom sheet on a phone, for movie match's
 * share and film-detail screens — the portal's only overlay. Back closes it on
 * a phone (lib/overlay-history.ts): a guest who opened an invite link in their
 * phone's browser expects Back to dismiss the sheet, not leave the room.
 *
 * No grabber: nothing drags it, and a handle that doesn't move is a native
 * app's affordance borrowed without its gesture. A backdrop tap, Escape and
 * each sheet's own Done close it.
 */
export default function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => pushOverlay(() => closeRef.current()), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return createPortal(
    <div
      className="sheet-backdrop mm-sheet-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div className="mm-sheet" role="dialog" aria-modal="true" aria-label={title}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
