import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Modal from "#components/Modal";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import controls from "#/styles/controls.module.css";
import type { Preroll } from "./types";
import { ACTION_LABELS, formatBytes, formatDuration } from "./utils";
import styles from "./Prerolls.module.css";

interface PrerollDetailModalProps {
  preroll: Preroll;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export default function PrerollDetailModal({ preroll, onClose, onDelete }: PrerollDetailModalProps) {
  const [name, setName] = useState(preroll.name);
  const { addToast } = useToast();
  const utils = trpc.useUtils();

  const updateMutation = trpc.prerolls.update.useMutation({
    onSuccess: () => utils.prerolls.list.invalidate(),
  });
  const retryMutation = trpc.prerolls.retry.useMutation({
    onSuccess: () => utils.prerolls.list.invalidate(),
  });

  // The list refetches while processing, so the row underneath this modal can
  // change out from under the local name state.
  useEffect(() => setName(preroll.name), [preroll.name]);

  const isReady = preroll.status === "ready";
  const dirty = name.trim() !== preroll.name && name.trim().length > 0;

  async function handleRename() {
    try {
      await updateMutation.mutateAsync({ id: preroll.id, name: name.trim() });
      addToast("Preroll renamed", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Couldn't rename that preroll", "error");
    }
  }

  async function handleRetry() {
    try {
      await retryMutation.mutateAsync({ id: preroll.id });
      addToast("Queued for processing", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Couldn't retry that preroll", "error");
    }
  }

  return (
    <Modal open onClose={onClose} title={preroll.name} size="lg">
      {isReady ? (
        <video className={styles.player} src={`/api/prerolls/${preroll.id}/preview`} controls preload="metadata" />
      ) : (
        <p className={styles.detailNotice}>
          {preroll.status === "failed"
            ? preroll.error || "Processing failed."
            : "This preroll is still being processed."}
        </p>
      )}

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Name</span>
        <div className={styles.fieldRow}>
          <input
            className={controls.input}
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirty) handleRename();
            }}
          />
          <button
            type="button"
            className={`${controls.btn} ${controls.btnSecondary}`}
            disabled={!dirty || updateMutation.isPending}
            onClick={handleRename}
          >
            Save
          </button>
        </div>
      </label>

      <dl className={styles.metaGrid}>
        {preroll.kind === "portal" ? (
          <div>
            <dt>Source</dt>
            <dd>
              {/* There is no file to replace: the card is edited where it's defined. */}
              <Link to="/settings/portal/preroll">Portal preroll card</Link>
            </dd>
          </div>
        ) : (
          <div>
            <dt>Original file</dt>
            <dd>{preroll.originalFilename}</dd>
          </div>
        )}
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(preroll.durationMs)}</dd>
        </div>
        <div>
          <dt>Resolution</dt>
          <dd>{preroll.width && preroll.height ? `${preroll.width} × ${preroll.height}` : "—"}</dd>
        </div>
        <div>
          <dt>Frame rate</dt>
          <dd>{preroll.fps ? `${preroll.fps.toFixed(2)} fps` : "—"}</dd>
        </div>
        <div>
          <dt>Video</dt>
          <dd>{preroll.videoCodec || "—"}</dd>
        </div>
        <div>
          <dt>Audio</dt>
          <dd>{preroll.audioCodec || "None"}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(preroll.sizeBytes)}</dd>
        </div>
        <div>
          <dt>Processing</dt>
          <dd>{ACTION_LABELS[preroll.transcodeAction] ?? "—"}</dd>
        </div>
      </dl>

      {preroll.transcodeReasons.length > 0 && (
        <div className={styles.reasons}>
          <p className={styles.reasonsTitle}>
            {preroll.transcodeAction === "copy"
              ? "Why it was left alone"
              : preroll.transcodeAction === "render"
                ? "What it shows"
                : "Why it was re-encoded"}
          </p>
          <ul>
            {preroll.transcodeReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.detailActions}>
        {preroll.status === "failed" && (
          <button
            type="button"
            className={`${controls.btn} ${controls.btnSecondary}`}
            onClick={handleRetry}
            disabled={retryMutation.isPending}
          >
            Try again
          </button>
        )}
        <button
          type="button"
          className={`${controls.btn} ${controls.btnDangerOutline}`}
          onClick={() => onDelete(preroll.id)}
        >
          Delete
        </button>
      </div>
    </Modal>
  );
}
