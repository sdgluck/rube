import { useState } from "react";
import Modal from "#components/Modal";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import controls from "#/styles/controls.module.css";
import styles from "./Prerolls.module.css";

interface ImportUrlModalProps {
  onClose: () => void;
  onImported: () => void;
}

export default function ImportUrlModal({ onClose, onImported }: ImportUrlModalProps) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const { addToast } = useToast();

  const importMutation = trpc.prerolls.importFromUrl.useMutation();

  async function handleImport() {
    try {
      await importMutation.mutateAsync({ url: url.trim(), name: name.trim() || undefined });
      addToast("Downloaded — processing now", "success");
      onImported();
      onClose();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Couldn't import that URL", "error");
    }
  }

  return (
    <Modal open onClose={onClose} title="Import from URL" size="md">
      <p className={styles.detailNotice}>
        The link must point directly at a video file — a page that merely embeds one won't work.
      </p>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Video URL</span>
        <input
          className={controls.input}
          value={url}
          placeholder="https://example.com/intro.mp4"
          autoFocus
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Name (optional)</span>
        <input
          className={controls.input}
          value={name}
          placeholder="Taken from the filename"
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <div className={styles.detailActions}>
        <button type="button" className={`${controls.btn} ${controls.btnGhost}`} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={`${controls.btn} ${controls.btnPrimary}`}
          onClick={handleImport}
          disabled={!url.trim() || importMutation.isPending}
        >
          {importMutation.isPending ? "Downloading…" : "Import"}
        </button>
      </div>
    </Modal>
  );
}
