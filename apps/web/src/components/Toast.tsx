import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Toast.module.css";

type ToastType = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  /** Runs on click. The toast dismisses itself immediately afterwards. */
  onAction: () => void;
}

export interface ToastOptions {
  duration?: number;
  /**
   * A second chance, offered where the first one has already happened.
   *
   * This is what makes "delete, then undo" possible at all — before it, every
   * destructive path in the app was a confirmation dialog and nothing else,
   * which trains people to click through rather than to read.
   */
  action?: ToastAction;
}

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
  exiting?: boolean;
}

interface ToastContextValue {
  /**
   * The third argument takes a plain number for the common "show it longer"
   * case, so every existing call site is untouched, or an options object when
   * the toast carries an action.
   */
  addToast: (message: string, type?: ToastType, options?: number | ToastOptions) => void;
}

/**
 * An undo offer has to outlive the reading of the sentence that offers it.
 * Four seconds is enough to notice a toast; it is not enough to read "deleted
 * 12 rules", think about it, and reach for the mouse.
 */
const ACTION_DURATION = 12000;

const ToastContext = createContext<ToastContextValue | null>(null);

/** Most toasts are transient confirmations; errors deserve time to be read. */
const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 4000,
  info: 4000,
  error: 8000,
};

/** Beyond this, the oldest toasts are dropped rather than stacked off-screen. */
const MAX_VISIBLE = 4;

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [announcement, setAnnouncement] = useState<{ polite: string; assertive: string }>({
    polite: "",
    assertive: "",
  });
  const idRef = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const removeToast = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 200);
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType = "info", options?: number | ToastOptions) => {
      const opts: ToastOptions = typeof options === "number" ? { duration: options } : (options ?? {});
      const { action } = opts;
      const id = ++idRef.current;
      let isDuplicate = false;
      setToasts((prev) => {
        // Repeating an identical message shouldn't stack copies of it — but an
        // actionable toast is never a duplicate. Two deletions in a row are two
        // separate things to undo, and collapsing them would silently drop the
        // offer to undo the second.
        if (!action && prev.some((t) => t.message === message && t.type === type && !t.exiting)) {
          isDuplicate = true;
          return prev;
        }
        return [...prev, { id, message, type, action }].slice(-MAX_VISIBLE);
      });
      if (isDuplicate) return;
      // Errors interrupt; confirmations wait for a pause. Announcing from a
      // dedicated live region rather than the toast itself keeps the visual
      // stack free to animate and reorder without re-announcing.
      setAnnouncement(type === "error" ? { polite: "", assertive: message } : { polite: message, assertive: "" });
      timers.current.set(
        id,
        setTimeout(() => removeToast(id), opts.duration ?? (action ? ACTION_DURATION : DEFAULT_DURATION[type])),
      );
    },
    [removeToast],
  );

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {createPortal(
        <>
          <div className={styles.container}>
            {toasts.map((toast) => (
              <div
                key={toast.id}
                className={`${styles.toast} ${styles[toast.type]} ${toast.exiting ? styles.toastExiting : ""}`}
                {...swipeToDismiss(() => removeToast(toast.id))}
              >
                <span className={styles.dot} aria-hidden="true" />
                <span>{toast.message}</span>
                {toast.action && (
                  <button
                    type="button"
                    className={styles.action}
                    onClick={() => {
                      toast.action?.onAction();
                      removeToast(toast.id);
                    }}
                  >
                    {toast.action.label}
                  </button>
                )}
                <button
                  type="button"
                  className={styles.dismiss}
                  onClick={() => removeToast(toast.id)}
                  aria-label="Dismiss message"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <div className={styles.srOnly} role="status" aria-live="polite">
            {announcement.polite}
          </div>
          <div className={styles.srOnly} role="alert" aria-live="assertive">
            {announcement.assertive}
          </div>
        </>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

/**
 * Flick a toast away, sideways or down, as native toasts and snackbars go.
 * Pointer events on the element itself: it follows the finger, and past a
 * threshold (or a fast flick) it leaves; otherwise it springs back.
 */
function swipeToDismiss(onDismiss: () => void) {
  let startX = 0;
  let startY = 0;
  let startT = 0;
  let tracking = false;
  return {
    onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
      if (e.pointerType !== "touch" || (e.target as Element).closest("button")) return;
      tracking = true;
      startX = e.clientX;
      startY = e.clientY;
      startT = performance.now();
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.style.transition = "none";
    },
    onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
      if (!tracking) return;
      const dx = e.clientX - startX;
      const dy = Math.max(0, e.clientY - startY);
      e.currentTarget.style.transform = `translate(${dx}px, ${dy}px)`;
      e.currentTarget.style.opacity = String(Math.max(0.2, 1 - Math.hypot(dx, dy) / 240));
    },
    onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - startX;
      const dy = Math.max(0, e.clientY - startY);
      const dist = Math.hypot(dx, dy);
      const fast = dist / Math.max(1, performance.now() - startT) > 0.5;
      const el = e.currentTarget;
      el.style.transition = "transform 0.25s ease, opacity 0.25s ease";
      if (dist > 80 || (fast && dist > 24)) {
        el.style.transform = `translate(${dx * 3}px, ${dy * 3}px)`;
        el.style.opacity = "0";
        onDismiss();
      } else {
        el.style.transform = "";
        el.style.opacity = "";
      }
    },
    onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
      tracking = false;
      e.currentTarget.style.transform = "";
      e.currentTarget.style.opacity = "";
    },
  };
}
