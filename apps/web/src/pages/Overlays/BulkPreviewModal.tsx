import styles from "../Overlays.module.css";

interface BulkPreviewModalProps {
  open: boolean;
  loading: boolean;
  items: Array<{ title: string; ratingKey: string; image: string }>;
  onClose: () => void;
}

export function BulkPreviewModal({ open, loading, items, onClose }: BulkPreviewModalProps) {
  if (!open) return null;
  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalLg} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Bulk Preview</h3>
          <button className={styles.modalClose} onClick={onClose}>
            ×
          </button>
        </div>
        {loading ? (
          <p className={styles.modalHint}>Rendering 6 random posters…</p>
        ) : (
          <div className={styles.bulkGrid}>
            {items.map((it) => (
              <div key={it.ratingKey} className={styles.bulkCell}>
                <img src={`data:image/jpeg;base64,${it.image}`} alt={it.title} />
                <span>{it.title}</span>
              </div>
            ))}
          </div>
        )}
        <p className={styles.modalHint}>Preview only — no changes have been made in Plex.</p>
      </div>
    </div>
  );
}
