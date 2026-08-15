import Modal from "./Modal";
import styles from "./AlertModal.module.css";

interface AlertModalProps {
  title: string;
  message: string;
  dismissLabel?: string;
  onDismiss: () => void;
}

/**
 * A one-button dialog for things the user needs to be told rather than asked —
 * a toast is too easy to miss when the message explains why what they just did
 * did something other than what they asked for.
 */
export default function AlertModal({ title, message, dismissLabel = "OK", onDismiss }: AlertModalProps) {
  return (
    <Modal open onClose={onDismiss} title={title} size="sm">
      <p className={styles.message}>{message}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.dismiss} onClick={onDismiss} autoFocus>
          {dismissLabel}
        </button>
      </div>
    </Modal>
  );
}
