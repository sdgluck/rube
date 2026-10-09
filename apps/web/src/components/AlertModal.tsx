import Modal from "./Modal";
import { useIsPhone } from "#hooks/useMediaQuery";
import alertStyles from "./AlertActions.module.css";
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
  const isPhone = useIsPhone();
  return (
    <Modal open onClose={onDismiss} title={title} size="sm" presentation="alert">
      <p className={styles.message}>{message}</p>
      <div className={isPhone ? alertStyles.row : styles.actions}>
        <button
          type="button"
          className={isPhone ? alertStyles.actionBold : styles.dismiss}
          onClick={onDismiss}
          autoFocus
        >
          {dismissLabel}
        </button>
      </div>
    </Modal>
  );
}
