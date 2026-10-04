import { useState } from "react";
import Modal from "#components/Modal";
import shared from "#/styles/shared.module.css";
import styles from "./BulkEditModal.module.css";

export interface BulkEditPatch {
  limit?: number;
  personalizable?: boolean;
}

interface BulkEditModalProps {
  /** Selected rules whose type has a Max collections. */
  limitEligibleCount: number;
  /** Selected rules that build a collection, so can be personalized. */
  personalizableEligibleCount: number;
  totalSelected: number;
  onApply: (patch: BulkEditPatch) => void;
  onCancel: () => void;
}

function skippedNote(eligible: number, total: number, why: string): string | null {
  const skipped = total - eligible;
  return skipped > 0 ? `${skipped} of ${total} will be skipped (${why}).` : null;
}

export default function BulkEditModal({
  limitEligibleCount,
  personalizableEligibleCount,
  totalSelected,
  onApply,
  onCancel,
}: BulkEditModalProps) {
  const [enableLimit, setEnableLimit] = useState(true);
  const [limit, setLimit] = useState<number>(10);
  // The way back from Personalized Collections' "make every rule
  // personalizable" — and the way to do it for a handful.
  const [enablePersonalizable, setEnablePersonalizable] = useState(false);
  const [personalizable, setPersonalizable] = useState(true);

  const limitApplies = enableLimit && limit >= 1 && limitEligibleCount > 0;
  const personalizableApplies = enablePersonalizable && personalizableEligibleCount > 0;
  const canApply = limitApplies || personalizableApplies;

  function handleApply() {
    const patch: BulkEditPatch = {};
    if (limitApplies) patch.limit = limit;
    if (personalizableApplies) patch.personalizable = personalizable;
    onApply(patch);
  }

  const limitSkipped = skippedNote(limitEligibleCount, totalSelected, "type has no Max collections");
  const personalizableSkipped = skippedNote(
    personalizableEligibleCount,
    totalSelected,
    "cleanup, playlist and metadata rules don't build a collection",
  );

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
        Apply changes to the {totalSelected} selected rule{totalSelected !== 1 ? "s" : ""}.
      </p>

      <div className={styles.fields}>
        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={enableLimit} onChange={(e) => setEnableLimit(e.target.checked)} />
          Set Max collections
        </label>
        {enableLimit && (
          <>
            <input
              type="number"
              className={`${shared.input} ${styles.limitInput}`}
              min={1}
              value={limit}
              onChange={(e) => setLimit(Math.max(1, parseInt(e.target.value, 10) || 1))}
              autoFocus
              aria-label="Max collections"
            />
            {limitSkipped && <p className={styles.optionNote}>{limitSkipped}</p>}
          </>
        )}

        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={enablePersonalizable}
            onChange={(e) => setEnablePersonalizable(e.target.checked)}
          />
          Set Personalizable
        </label>
        {enablePersonalizable && (
          <>
            <select
              className={`${shared.select} ${styles.personalizableSelect}`}
              value={personalizable ? "on" : "off"}
              onChange={(e) => setPersonalizable(e.target.value === "on")}
              aria-label="Personalizable"
            >
              <option value="on">On — a copy per opted-in user</option>
              <option value="off">Off</option>
            </select>
            {personalizableSkipped && <p className={styles.optionNote}>{personalizableSkipped}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
