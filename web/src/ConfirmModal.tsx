import { useEffect, useRef, useState, useCallback } from "react";
import styles from "./ConfirmModal.module.css";

interface ConfirmModalProps {
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  message,
  confirmLabel = "Confirm",
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  const handleClose = useCallback(() => {
    setExiting(true);
    setTimeout(() => onCancel(), 200);
  }, [onCancel]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleClose]);

  return (
    <div className={`${styles.backdrop} ${exiting ? styles.backdropExiting : ""}`} onClick={handleClose}>
      <div className={`${styles.modal} ${exiting ? styles.modalExiting : ""}`} onClick={(e) => e.stopPropagation()}>
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <button
            ref={confirmRef}
            className={`${styles.btn} ${danger ? styles.btnDanger : styles.btnPrimary}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={handleClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
