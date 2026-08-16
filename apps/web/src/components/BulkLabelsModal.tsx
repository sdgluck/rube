import { useState } from "react";
import Modal from "./Modal";
import styles from "./BulkLabelsModal.module.css";
import shared from "#/styles/shared.module.css";

interface Props {
  count: number;
  existingLabels: string[];
  onApply: (input: { add: string[]; remove: Set<string> }) => void;
  onCancel: () => void;
  /** What is being labelled. Singular; pluralised for the title. */
  noun?: string;
  /**
   * Type the labels to remove instead of ticking them.
   *
   * For callers that cannot enumerate what the selection already carries —
   * a hundred media items each with their own labels would be a round trip
   * per item before the dialog could open. The removal still applies only
   * where the label is actually present.
   */
  freeTextRemove?: boolean;
}

const MANAGED_LABELS = ["tinkerbell", "generated", "becauseyouwatched"];

export default function BulkLabelsModal({
  count,
  existingLabels,
  onApply,
  onCancel,
  noun = "collection",
  freeTextRemove = false,
}: Props) {
  const [labelsToAdd, setLabelsToAdd] = useState("");
  const [labelsToRemove, setLabelsToRemove] = useState<Set<string>>(new Set());
  const [removeText, setRemoveText] = useState("");

  const splitList = (value: string) =>
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const addList = splitList(labelsToAdd);
  const removeList = freeTextRemove ? new Set(splitList(removeText)) : labelsToRemove;
  const canApply = addList.length > 0 || removeList.size > 0;

  const labelClass = (lbl: string) => {
    const lower = lbl.toLowerCase();
    if (MANAGED_LABELS.includes(lower)) return shared.labelTinkerbell;
    if (lower.startsWith("user:")) return shared.labelUser;
    return "";
  };

  return (
    <Modal
      open
      onClose={onCancel}
      size="md"
      title={`Edit labels on ${count} ${noun}${count !== 1 ? "s" : ""}`}
      footer={
        <>
          <button type="button" className={styles.cancel} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.apply}
            disabled={!canApply}
            onClick={() => onApply({ add: addList, remove: removeList })}
          >
            Apply
          </button>
        </>
      }
    >
      <div className={shared.labelEditorRow}>
        <label htmlFor="bulk-labels-add">Add labels:</label>
        <input
          id="bulk-labels-add"
          type="text"
          autoFocus
          className={shared.labelEditorInput}
          placeholder="Label1, Label2, …"
          value={labelsToAdd}
          onChange={(e) => setLabelsToAdd(e.target.value)}
        />
      </div>
      {freeTextRemove && (
        <div className={`${shared.labelEditorRow} ${styles.removeRow}`}>
          <label htmlFor="bulk-labels-remove">Remove labels:</label>
          <input
            id="bulk-labels-remove"
            type="text"
            className={shared.labelEditorInput}
            placeholder="Label1, Label2, …"
            value={removeText}
            onChange={(e) => setRemoveText(e.target.value)}
          />
        </div>
      )}
      {!freeTextRemove && existingLabels.length > 0 && (
        <div className={`${shared.labelEditorRow} ${styles.removeRow}`}>
          <label>Remove labels:</label>
          <div className={shared.labelCheckboxList}>
            {existingLabels.map((lbl) => (
              <label key={lbl} className={shared.labelCheckboxItem}>
                <input
                  type="checkbox"
                  checked={labelsToRemove.has(lbl)}
                  onChange={() =>
                    setLabelsToRemove((prev) => {
                      const next = new Set(prev);
                      if (next.has(lbl)) next.delete(lbl);
                      else next.add(lbl);
                      return next;
                    })
                  }
                />
                <span className={`${shared.label} ${labelClass(lbl)}`}>{lbl}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
