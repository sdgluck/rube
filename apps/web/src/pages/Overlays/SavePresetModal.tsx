import Modal from "#components/Modal";
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
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Save preset"
      size="sm"
      footer={
        <>
          <button type="button" className={styles.smallBtn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.actionBtnPrimary} disabled={!name.trim() || saving} onClick={onSave}>
            {saving ? (
              <>
                <Spinner size="xs" /> Saving…
              </>
            ) : (
              "Save"
            )}
          </button>
        </>
      }
    >
      <label className={styles.fieldLabel} htmlFor="preset-name">
        Name
      </label>
      <input
        id="preset-name"
        className={styles.fieldInput}
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="My overlay style"
        autoFocus
      />
      <label className={styles.fieldLabel} htmlFor="preset-description">
        Description
      </label>
      <input
        id="preset-description"
        className={styles.fieldInput}
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        placeholder="Optional"
      />
    </Modal>
  );
}
