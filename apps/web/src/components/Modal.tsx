import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Modal.module.css";

type Size = "sm" | "md" | "lg" | "xl";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name. Rendered as the dialog heading unless `hideTitle`. */
  title: string;
  hideTitle?: boolean;
  /** Mono string beside the title — a step count, a scope, a total. */
  meta?: ReactNode;
  size?: Size;
  /** Suppress the default close button — for dialogs with their own header. */
  hideCloseButton?: boolean;
  /** Clicking the backdrop closes by default; disable for destructive flows. */
  dismissOnBackdrop?: boolean;
  /** Pinned to the bottom of the panel, outside the scrolling body. */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Exit animation duration; must match the modalOut/backdropOut timing in CSS. */
const EXIT_MS = 200;

/**
 * The app's only modal shell.
 *
 * Six hand-rolled versions of this existed, of which exactly one set
 * role="dialog", none trapped focus, none restored focus to the trigger, none
 * locked body scroll, and their backdrops sat at four different z-indexes —
 * three of them below the page chrome.
 *
 * The same centred dialog at every width — on a phone it is simply the width
 * of the screen less a margin. It used to become a draggable bottom sheet
 * whose history entry made Back close it; that was the admin app imitating a
 * native one, which the real native apps (`native/`) now are.
 */
export default function Modal({
  open,
  onClose,
  title,
  hideTitle = false,
  meta,
  size = "md",
  hideCloseButton = false,
  dismissOnBackdrop = true,
  footer,
  className,
  children,
}: ModalProps) {
  const [exiting, setExiting] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const close = useCallback(() => {
    setExiting(true);
    window.setTimeout(() => {
      setExiting(false);
      onClose();
    }, EXIT_MS);
  }, [onClose]);

  // Remember the trigger so focus can go back where the user left it.
  useEffect(() => {
    if (open) restoreFocusTo.current = document.activeElement as HTMLElement | null;
  }, [open]);

  // Move focus into the panel on open, and back out on close.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const first = panel.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel).focus({ preventScroll: true });
    return () => restoreFocusTo.current?.focus?.({ preventScroll: true });
  }, [open]);

  // Body scroll lock. Compensates for the scrollbar so the page doesn't jump.
  useEffect(() => {
    if (!open) return;
    const { overflow, paddingRight } = document.body.style;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
    };
  }, [open]);

  // Escape to close, Tab cycles within the panel.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, close]);

  if (!open && !exiting) return null;

  return createPortal(
    <div
      className={`${styles.backdrop} ${exiting ? styles.backdropExiting : ""}`}
      onMouseDown={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`${styles.panel} ${styles[size]} ${exiting ? styles.panelExiting : ""} ${className ?? ""}`}
      >
        <div className={hideTitle ? styles.headerVisuallyHidden : styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {meta && <span className={styles.meta}>{meta}</span>}
          {!hideCloseButton && (
            <button type="button" className={styles.close} onClick={close} aria-label="Close dialog">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
