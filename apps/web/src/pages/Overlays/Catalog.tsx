import { useState } from "react";
import Modal from "#components/Modal";
import { useMediaQuery } from "#hooks/useMediaQuery";
import styles from "../Overlays.module.css";
import { OVERLAY_CATALOG, POSITIONS } from "./constants";
import { badgePreviewStyle } from "./helpers";
import type { OverlayPosition, OverlayType } from "@tinkerbell/contracts";

/**
 * The badge catalog. With a mouse a badge is dragged onto the poster; a touch
 * screen has no HTML5 drag-and-drop (Android) or hides it behind a long press
 * (iOS), so there a tap asks where to put it, as a 3×3 grid of the positions
 * laid out the way they sit on the poster. Keyed on the pointer rather than the
 * width: a tablet has the same problem a phone does.
 */
export function Catalog({ onAdd }: { onAdd?: (position: OverlayPosition, type: OverlayType) => void }) {
  const isTouch = useMediaQuery("(pointer: coarse)");
  const [placing, setPlacing] = useState<OverlayType | null>(null);
  return (
    <aside className={styles.catalog}>
      <h3 className={styles.paneTitle}>Overlays</h3>
      <div className={styles.panelBody}>
        {(["Quality", "Audio", "Ratings", "Metadata"] as const).map((group) => (
          <div key={group} className={styles.catalogGroup}>
            <div className={styles.catalogGroupLabel}>{group}</div>
            <div className={styles.chipList}>
              {OVERLAY_CATALOG.filter((c) => c.group === group).map((chip) => (
                <div
                  key={chip.type}
                  className={styles.catalogChip}
                  draggable
                  role={isTouch ? "button" : undefined}
                  onClick={isTouch && onAdd ? () => setPlacing(chip.type) : undefined}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "new", type: chip.type }));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                >
                  <span className={styles.catalogChipLabel}>{chip.label}</span>
                  <span
                    className={styles.catalogChipSample}
                    style={badgePreviewStyle(chip.type, chip.sample, null, { compact: true })}
                  >
                    {chip.sample}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {isTouch && onAdd && (
        <Modal open={placing !== null} onClose={() => setPlacing(null)} title="Place the badge" size="sm">
          <div className={styles.placeGrid}>
            {POSITIONS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={styles.placeBtn}
                onClick={() => {
                  if (placing) onAdd(p.id, placing);
                  setPlacing(null);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </aside>
  );
}
