import { useRef } from "react";
import Modal from "#components/Modal";
import Spinner from "#components/Spinner";
import styles from "../Overlays.module.css";

interface ImportLayoutModalProps {
  open: boolean;
  text: string;
  mode: "replace" | "append";
  error: string | null;
  importing: boolean;
  existingCount: number;
  onTextChange: (v: string) => void;
  onModeChange: (v: "replace" | "append") => void;
  onPickFile: (file: File) => void;
  onClose: () => void;
  onImport: () => void;
}

export function ImportLayoutModal({
  open,
  text,
  mode,
  error,
  importing,
  existingCount,
  onTextChange,
  onModeChange,
  onPickFile,
  onClose,
  onImport,
}: ImportLayoutModalProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import layout"
      size="md"
      footer={
        <>
          <button type="button" className={styles.smallBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.actionBtnPrimary}
            disabled={!text.trim() || importing}
            onClick={onImport}
          >
            {importing ? (
              <>
                <Spinner size="xs" /> Importing…
              </>
            ) : (
              "Import"
            )}
          </button>
        </>
      }
    >
      <p className={styles.modalHintStart}>Choose a JSON file exported from this page, or paste its contents.</p>
      <div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className={styles.hiddenFileInput}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPickFile(f);
            e.target.value = "";
          }}
        />
        <button type="button" className={styles.smallBtn} onClick={() => fileRef.current?.click()}>
          Choose file…
        </button>
      </div>
      <textarea
        className={`${styles.input} ${styles.importTextarea}`}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder='{"version":1,"configs":[…]}'
        rows={8}
        aria-label="Layout JSON"
      />
      <div className={styles.checkRow}>
        <label className={styles.checkLabel}>
          <input type="radio" name="importMode" checked={mode === "replace"} onChange={() => onModeChange("replace")} />
          Replace ({existingCount} existing will be removed)
        </label>
        <label className={styles.checkLabel}>
          <input type="radio" name="importMode" checked={mode === "append"} onChange={() => onModeChange("append")} />
          Append to existing
        </label>
      </div>
      {error && (
        <p className={styles.fieldError} role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
