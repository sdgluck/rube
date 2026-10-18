import { useEffect, useRef } from "react";
import Modal from "./Modal";
import { useIsPhone } from "#hooks/useMediaQuery";
import alertStyles from "./AlertActions.module.css";
import styles from "./ConfirmModal.module.css";

interface ConfirmModalProps {
  message: string;
  /** Heading. Defaults to a neutral prompt; prefer something specific. */
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Styles the confirm button as destructive and requires an explicit
   * dismissal rather than a stray backdrop click. Defaults to false — it used
   * to default to true, which painted every confirmation red.
   */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  message,
  title = "Are you sure?",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const isPhone = useIsPhone();

  // Destructive prompts open on Cancel so Enter can't confirm by reflex.
  useEffect(() => {
    if (danger) cancelRef.current?.focus();
  }, [danger]);

  return (
    <Modal open onClose={onCancel} title={title} size="sm" dismissOnBackdrop={!danger} presentation="alert">
      <p className={styles.message}>{message}</p>
      {isPhone ? (
        // Cancel first on both platforms: iOS puts it on the left, Material
        // puts the confirming action rightmost.
        <div className={alertStyles.row}>
          <button type="button" ref={cancelRef} className={alertStyles.action} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? alertStyles.actionDanger : alertStyles.actionBold}
            onClick={() => {
              onConfirm();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className={danger ? styles.confirmDanger : styles.confirm}
            onClick={onConfirm}
            autoFocus={!danger}
          >
            {confirmLabel}
          </button>
          <button type="button" ref={cancelRef} className={styles.cancel} onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      )}
    </Modal>
  );
}
