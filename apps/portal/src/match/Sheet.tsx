import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { pushOverlay } from "../lib/overlay-history.ts";

/**
 * A centred card on a desktop and a bottom sheet on a phone, for movie match's
 * share and film-detail screens. The portal's `ActionSheet` is a list of
 * choices; these hold content. Back closes it, as it does every overlay.
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
        <span className="sheet-grabber" aria-hidden />
        {children}
      </div>
    </div>,
    document.body,
  );
}
