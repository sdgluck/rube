import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Toast.module.css";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  exiting?: boolean;
}

interface ToastContextValue {
  addToast: (message: string, type?: ToastType, duration?: number) => void;
}

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
    (message: string, type: ToastType = "info", duration?: number) => {
      const id = ++idRef.current;
      let isDuplicate = false;
      setToasts((prev) => {
        // Repeating an identical message shouldn't stack copies of it.
        if (prev.some((t) => t.message === message && t.type === type && !t.exiting)) {
          isDuplicate = true;
          return prev;
        }
        return [...prev, { id, message, type }].slice(-MAX_VISIBLE);
      });
      if (isDuplicate) return;
      // Errors interrupt; confirmations wait for a pause. Announcing from a
      // dedicated live region rather than the toast itself keeps the visual
      // stack free to animate and reorder without re-announcing.
      setAnnouncement(type === "error" ? { polite: "", assertive: message } : { polite: message, assertive: "" });
      timers.current.set(
        id,
        setTimeout(() => removeToast(id), duration ?? DEFAULT_DURATION[type]),
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
              >
                <span className={styles.dot} aria-hidden="true" />
                <span>{toast.message}</span>
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
