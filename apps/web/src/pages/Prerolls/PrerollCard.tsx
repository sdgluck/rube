import ToggleSwitch from "#components/ToggleSwitch";
import type { Preroll } from "./types";
import { ACTION_LABELS, STATUS_LABELS, formatBytes, formatDuration, formatResolution } from "./utils";
import styles from "./Prerolls.module.css";
import { prerollThumbUrl } from "#lib/media";

interface PrerollCardProps {
  preroll: Preroll;
  selected: boolean;
  /** Sequential mode surfaces the drag handle and order number. */
  ordered: boolean;
  onSelect: (id: string, selected: boolean, shiftKey: boolean) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onOpen: (id: string) => void;
  onDragStart?: (id: string) => void;
  onDragOver?: (id: string) => void;
  onDragEnd?: () => void;
}

export default function PrerollCard({
  preroll,
  selected,
  ordered,
  onSelect,
  onToggleEnabled,
  onOpen,
  onDragStart,
  onDragOver,
  onDragEnd,
}: PrerollCardProps) {
  const isReady = preroll.status === "ready";
  const isBusy = preroll.status === "pending" || preroll.status === "processing";

  return (
    <article
      className={`${styles.prerollCard} ${selected ? styles.cardSelected : ""}`}
      data-status={preroll.status}
      draggable={ordered && isReady}
      onDragStart={() => onDragStart?.(preroll.id)}
      onDragOver={(e) => {
        if (!ordered) return;
        e.preventDefault();
        onDragOver?.(preroll.id);
      }}
      onDragEnd={onDragEnd}
    >
      <div className={styles.cardThumb} onClick={() => onOpen(preroll.id)} role="presentation">
        {isReady ? (
          <img src={prerollThumbUrl(preroll.id)} alt="" loading="lazy" className={styles.cardThumbImg} />
        ) : (
          <div className={styles.cardThumbPlaceholder} aria-hidden="true" />
        )}
        {isReady && <span className={styles.cardDuration}>{formatDuration(preroll.durationMs)}</span>}
        {ordered && isReady && <span className={styles.cardOrder}>{preroll.position + 1}</span>}
      </div>

      <div className={styles.cardBody}>
        <div className={styles.cardHeader}>
          <label className={styles.cardCheckbox}>
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => onSelect(preroll.id, e.target.checked, (e.nativeEvent as MouseEvent).shiftKey)}
              aria-label={`Select ${preroll.name}`}
            />
          </label>
          <button type="button" className={styles.cardTitle} onClick={() => onOpen(preroll.id)}>
            {preroll.name}
          </button>
          <ToggleSwitch
            size="sm"
            checked={preroll.enabled === 1}
            disabled={!isReady}
            onChange={(next) => onToggleEnabled(preroll.id, next)}
          />
        </div>

        {isBusy && (
          <p className={styles.cardStatus} data-tone="busy">
            {STATUS_LABELS[preroll.status]}…
          </p>
        )}

        {preroll.status === "failed" && (
          <p className={styles.cardStatus} data-tone="error">
            {preroll.error || "Processing failed"}
          </p>
        )}

        {isReady && (
          <ul className={styles.chips}>
            <li className={styles.chip}>{formatResolution(preroll)}</li>
            <li className={styles.chip}>{preroll.videoCodec || "—"}</li>
            <li className={styles.chip}>{formatBytes(preroll.sizeBytes)}</li>
            {preroll.transcodeAction && (
              <li className={styles.chip} data-variant="muted">
                {ACTION_LABELS[preroll.transcodeAction] ?? preroll.transcodeAction}
              </li>
            )}
          </ul>
        )}
      </div>
    </article>
  );
}
