import { useRef } from "react";
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
  if (!open) return null;
  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Import layout</h3>
          <button className={styles.modalClose} onClick={onClose}>
            ×
          </button>
        </div>
        <p className={styles.modalHint} style={{ textAlign: "left" }}>
          Choose a JSON file exported from this page, or paste its contents.
        </p>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickFile(f);
              e.target.value = "";
            }}
          />
          <button className={styles.smallBtn} onClick={() => fileRef.current?.click()}>
            Choose file…
          </button>
        </div>
        <textarea
          className={styles.input}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder='{"version":1,"configs":[…]}'
          rows={8}
          style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", resize: "vertical" }}
        />
        <div className={styles.checkRow}>
          <label className={styles.checkLabel}>
            <input
              type="radio"
              name="importMode"
              checked={mode === "replace"}
              onChange={() => onModeChange("replace")}
            />
            Replace ({existingCount} existing will be removed)
          </label>
          <label className={styles.checkLabel}>
            <input type="radio" name="importMode" checked={mode === "append"} onChange={() => onModeChange("append")} />
            Append to existing
          </label>
        </div>
        {error && (
          <p className={styles.fieldHint} style={{ color: "#dc3545" }}>
            {error}
          </p>
        )}
        <div className={styles.modalActions}>
          <button className={styles.smallBtn} onClick={onClose}>
            Cancel
          </button>
          <button className={styles.actionBtnPrimary} disabled={!text.trim() || importing} onClick={onImport}>
            {importing ? (
              <>
                <Spinner size="xs" /> Importing…
              </>
            ) : (
              "Import"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
