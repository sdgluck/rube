import { useState } from "react";
import Modal from "#components/Modal";
import shared from "#/styles/shared.module.css";
import styles from "./BulkEditModal.module.css";

interface BulkEditModalProps {
  eligibleCount: number;
  totalSelected: number;
  onApply: (patch: { limit?: number }) => void;
  onCancel: () => void;
}

export default function BulkEditModal({ eligibleCount, totalSelected, onApply, onCancel }: BulkEditModalProps) {
  const [enableLimit, setEnableLimit] = useState(true);
  const [limit, setLimit] = useState<number>(10);

  const skipped = totalSelected - eligibleCount;
  const canApply = enableLimit && limit >= 1 && eligibleCount > 0;

  function handleApply() {
    const patch: { limit?: number } = {};
    if (enableLimit) patch.limit = limit;
    onApply(patch);
  }

  return (
    <Modal
      open
      onClose={onCancel}
      title="Bulk edit rules"
      size="sm"
      footer={
        <>
          <button type="button" className={styles.cancel} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={styles.apply} onClick={handleApply} disabled={!canApply}>
            Apply
          </button>
        </>
      }
    >
      <p className={styles.summary}>
        Apply changes to {eligibleCount} of {totalSelected} selected rule{totalSelected !== 1 ? "s" : ""}.
        {skipped > 0 && ` ${skipped} rule${skipped !== 1 ? "s" : ""} will be skipped (type has no Max collections).`}
      </p>

      <div className={styles.fields}>
        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={enableLimit} onChange={(e) => setEnableLimit(e.target.checked)} />
          Set Max collections
        </label>
        {enableLimit && (
          <input
            type="number"
            className={`${shared.input} ${styles.limitInput}`}
            min={1}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, parseInt(e.target.value, 10) || 1))}
            autoFocus
            aria-label="Max collections"
          />
        )}
      </div>
    </Modal>
  );
}
