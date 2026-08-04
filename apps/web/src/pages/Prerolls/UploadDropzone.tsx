import { useRef, useState } from "react";
import type { UploadItem } from "./types";
import styles from "./Prerolls.module.css";

interface UploadDropzoneProps {
  uploads: UploadItem[];
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}

/**
 * Drag-and-drop target plus a hidden file input, following the trigger
 * pattern already used by Settings → Portal → Appearance.
 */
export default function UploadDropzone({ uploads, disabled, onFiles }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    onFiles(Array.from(list));
  }

  return (
    <div>
      <div
        className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ""}`}
        data-disabled={disabled ? "true" : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) handleFiles(e.dataTransfer.files);
        }}
      >
        <p className={styles.dropzoneTitle}>Drop video files here</p>
        <p className={styles.dropzoneHint}>MP4, MOV, MKV, WebM, AVI and friends — up to 2 GB each</p>
        <button
          type="button"
          className={styles.dropzoneButton}
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
        >
          Choose files
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          multiple
          hidden
          onChange={(e) => {
            handleFiles(e.target.files);
            // Reset so re-picking the same file fires change again.
            e.target.value = "";
          }}
        />
      </div>

      {uploads.length > 0 && (
        <ul className={styles.uploadList}>
          {uploads.map((upload) => (
            <li key={upload.key} className={styles.uploadRow}>
              <span className={styles.uploadName}>{upload.filename}</span>
              {upload.error ? (
                <span className={styles.uploadError}>{upload.error}</span>
              ) : (
                <>
                  <span className={styles.progressBar}>
                    <span className={styles.progressFill} style={{ width: `${Math.round(upload.progress * 100)}%` }} />
                  </span>
                  <span className={styles.uploadPercent}>{Math.round(upload.progress * 100)}%</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
