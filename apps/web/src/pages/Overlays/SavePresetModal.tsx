import Spinner from "#components/Spinner";
import styles from "../Overlays.module.css";

interface SavePresetModalProps {
  open: boolean;
  name: string;
  description: string;
  saving: boolean;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export function SavePresetModal({
  open,
  name,
  description,
  saving,
  onNameChange,
  onDescriptionChange,
  onClose,
  onSave,
}: SavePresetModalProps) {
  if (!open) return null;
  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Save preset</h3>
          <button className={styles.modalClose} onClick={onClose}>
            ×
          </button>
        </div>
        <label className={styles.fieldLabel}>Name</label>
        <input
          className={styles.input}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="My overlay style"
          autoFocus
        />
        <label className={styles.fieldLabel}>Description</label>
        <input
          className={styles.input}
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Optional"
        />
        <div className={styles.modalActions}>
          <button className={styles.smallBtn} onClick={onClose}>
            Cancel
          </button>
          <button className={styles.actionBtnPrimary} disabled={!name.trim() || saving} onClick={onSave}>
            {saving ? (
              <>
                <Spinner size="xs" /> Saving…
              </>
            ) : (
              "Save"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
