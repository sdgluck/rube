import { useCallback, useEffect, useState } from "react";
import shared from "#/styles/shared.module.css";
import modalStyles from "#components/ConfirmModal.module.css";

interface BulkEditModalProps {
  eligibleCount: number;
  totalSelected: number;
  onApply: (patch: { limit?: number }) => void;
  onCancel: () => void;
}

export default function BulkEditModal({ eligibleCount, totalSelected, onApply, onCancel }: BulkEditModalProps) {
  const [enableLimit, setEnableLimit] = useState(true);
  const [limit, setLimit] = useState<number>(10);
  const [exiting, setExiting] = useState(false);

  const handleClose = useCallback(() => {
    setExiting(true);
    setTimeout(onCancel, 200);
  }, [onCancel]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleClose]);

  const skipped = totalSelected - eligibleCount;
  const canApply = enableLimit && limit >= 1 && eligibleCount > 0;

  function handleApply() {
    const patch: { limit?: number } = {};
    if (enableLimit) patch.limit = limit;
    onApply(patch);
  }

  return (
    <div className={`${modalStyles.backdrop} ${exiting ? modalStyles.backdropExiting : ""}`} onClick={handleClose}>
      <div
        className={`${modalStyles.modal} ${exiting ? modalStyles.modalExiting : ""}`}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 460 }}
      >
        <h3 style={{ margin: "0 0 4px", fontSize: "1rem" }}>Bulk edit rules</h3>
        <p style={{ margin: "0 0 16px", fontSize: "0.85rem", color: "var(--text-muted)" }}>
          Apply changes to {eligibleCount} of {totalSelected} selected rule{totalSelected !== 1 ? "s" : ""}.
          {skipped > 0 && ` ${skipped} rule${skipped !== 1 ? "s" : ""} will be skipped (type has no Max collections).`}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "0.9rem" }}>
            <input type="checkbox" checked={enableLimit} onChange={(e) => setEnableLimit(e.target.checked)} />
            Set Max collections
          </label>
          {enableLimit && (
            <input
              type="number"
              className={shared.input}
              style={{ maxWidth: 140, marginLeft: 26 }}
              min={1}
              value={limit}
              onChange={(e) => setLimit(Math.max(1, parseInt(e.target.value, 10) || 1))}
              autoFocus
            />
          )}
        </div>

        <div className={modalStyles.actions}>
          <button className={`${modalStyles.btn} ${modalStyles.btnPrimary}`} onClick={handleApply} disabled={!canApply}>
            Apply
          </button>
          <button className={`${modalStyles.btn} ${modalStyles.btnSecondary}`} onClick={handleClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
