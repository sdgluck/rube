import { useCallback, useEffect, useState } from "react";
import confirmStyles from "./ConfirmModal.module.css";
import collectionsStyles from "#/styles/shared.module.css";

interface Props {
  count: number;
  existingLabels: string[];
  onApply: (input: { add: string[]; remove: Set<string> }) => void;
  onCancel: () => void;
}

export default function BulkLabelsModal({ count, existingLabels, onApply, onCancel }: Props) {
  const [exiting, setExiting] = useState(false);
  const [labelsToAdd, setLabelsToAdd] = useState("");
  const [labelsToRemove, setLabelsToRemove] = useState<Set<string>>(new Set());

  const handleClose = useCallback(() => {
    setExiting(true);
    setTimeout(() => onCancel(), 200);
  }, [onCancel]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handleClose]);

  const addList = labelsToAdd
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const canApply = addList.length > 0 || labelsToRemove.size > 0;

  return (
    <div className={`${confirmStyles.backdrop} ${exiting ? confirmStyles.backdropExiting : ""}`} onClick={handleClose}>
      <div
        className={`${confirmStyles.modal} ${exiting ? confirmStyles.modalExiting : ""}`}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 520 }}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: "1.05rem", fontWeight: 600 }}>
          Edit labels on {count} collection{count !== 1 ? "s" : ""}
        </h3>
        <div className={collectionsStyles.labelEditorRow}>
          <label>Add labels:</label>
          <input
            type="text"
            autoFocus
            className={collectionsStyles.labelEditorInput}
            placeholder="Label1, Label2, ..."
            value={labelsToAdd}
            onChange={(e) => setLabelsToAdd(e.target.value)}
          />
        </div>
        {existingLabels.length > 0 && (
          <div className={collectionsStyles.labelEditorRow} style={{ marginTop: 12 }}>
            <label>Remove labels:</label>
            <div className={collectionsStyles.labelCheckboxList}>
              {existingLabels.map((lbl) => (
                <span key={lbl} className={collectionsStyles.labelCheckboxItem}>
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
                  <span
                    className={`${collectionsStyles.label} ${
                      ["tinkerbell", "generated", "becauseyouwatched"].includes(lbl.toLowerCase())
                        ? collectionsStyles.labelTinkerbell
                        : lbl.toLowerCase().startsWith("user:")
                          ? collectionsStyles.labelUser
                          : ""
                    }`}
                  >
                    {lbl}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
        <div className={confirmStyles.actions} style={{ marginTop: 20 }}>
          <button
            className={`${confirmStyles.btn} ${confirmStyles.btnPrimary}`}
            disabled={!canApply}
            onClick={() => onApply({ add: addList, remove: labelsToRemove })}
          >
            Apply
          </button>
          <button className={`${confirmStyles.btn} ${confirmStyles.btnSecondary}`} onClick={handleClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
