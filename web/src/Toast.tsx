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

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 200);
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType = "info", duration = 4000) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => removeToast(id), duration);
    },
    [removeToast],
  );

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {createPortal(
        <div className={styles.container}>
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`${styles.toast} ${styles[toast.type]} ${toast.exiting ? styles.toastExiting : ""}`}
            >
              <span>{toast.message}</span>
              <button className={styles.dismiss} onClick={() => removeToast(toast.id)}>
                &times;
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
