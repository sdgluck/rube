import { useMemo, useState } from "react";
import Modal from "#components/Modal";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import controls from "#/styles/controls.module.css";
import { formatBytes } from "./utils";
import styles from "./Prerolls.module.css";

interface ImportExistingModalProps {
  onClose: () => void;
  onImported: () => void;
}

/**
 * Adopt videos that are already sitting in the prerolls folder.
 *
 * The folder is a bind mount the admin can write to directly, so it commonly
 * arrives with content Rube has never seen. This lists what's there and
 * hands the selection to the same processing pipeline an upload goes through.
 */
export default function ImportExistingModal({ onClose, onImported }: ImportExistingModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { addToast } = useToast();

  const scanQuery = trpc.prerolls.scanExisting.useQuery();
  const importMutation = trpc.prerolls.importExisting.useMutation();

  const files = useMemo(() => scanQuery.data ?? [], [scanQuery.data]);
  const allSelected = files.length > 0 && selected.size === files.length;

  function toggle(filename: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(filename);
      else next.delete(filename);
      return next;
    });
  }

  async function handleImport() {
    try {
      const { imported, failed } = await importMutation.mutateAsync({ filenames: [...selected] });
      if (imported > 0) {
        addToast(imported === 1 ? "Importing 1 preroll" : `Importing ${imported} prerolls`, "success");
        onImported();
      }
      // Reported rather than swallowed: a file that vanished between the scan
      // and the click is worth saying out loud, not silently short-counting.
      for (const failure of failed) {
        addToast(`${failure.filename}: ${failure.error}`, "error");
      }
      if (imported > 0) onClose();
      else scanQuery.refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Couldn't import those files", "error");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Import existing files"
      meta={files.length > 0 ? `${files.length} found` : undefined}
      size="md"
      footer={
        <div className={styles.detailActions}>
          <button type="button" className={`${controls.btn} ${controls.btnGhost}`} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`${controls.btn} ${controls.btnPrimary}`}
            onClick={handleImport}
            disabled={selected.size === 0 || importMutation.isPending}
          >
            {importMutation.isPending ? "Importing…" : `Import ${selected.size || ""}`.trim()}
          </button>
        </div>
      }
    >
      <p className={styles.detailNotice}>
        Unmanaged videos in the prerolls folder. Transcoded only if Plex can't direct play them.
      </p>

      {scanQuery.isLoading ? (
        <p className={styles.scanEmpty}>Scanning…</p>
      ) : scanQuery.error ? (
        <p className={styles.scanEmpty}>{scanQuery.error.message}</p>
      ) : files.length === 0 ? (
        <p className={styles.scanEmpty}>
          Nothing to import — every video in the folder is already part of the library.
        </p>
      ) : (
        <>
          <label className={styles.scanAll}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => setSelected(e.target.checked ? new Set(files.map((f) => f.filename)) : new Set())}
            />
            <span>Select all</span>
          </label>

          <ul className={styles.scanList}>
            {files.map((file) => (
              <li key={file.filename}>
                <label className={styles.scanRow}>
                  <input
                    type="checkbox"
                    checked={selected.has(file.filename)}
                    onChange={(e) => toggle(file.filename, e.target.checked)}
                  />
                  <span className={styles.scanName}>{file.filename}</span>
                  <span className={styles.scanSize}>{formatBytes(file.sizeBytes)}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
