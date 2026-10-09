import { useState } from "react";
import ActionSheet from "#components/ActionSheet";
import { useIsPhone } from "#hooks/useMediaQuery";
import styles from "../Overlays.module.css";
import { OVERLAY_CATALOG, POSITIONS } from "./constants";
import { badgePreviewStyle } from "./helpers";
import type { OverlayPosition, OverlayType } from "@tinkerbell/contracts";

/**
 * The badge catalog. On a desktop a badge is dragged onto the poster; a phone
 * has no HTML5 drag-and-drop (Android) or hides it behind a long press (iOS),
 * so there a tap asks where to put it, in an action sheet.
 */
export function Catalog({ onAdd }: { onAdd?: (position: OverlayPosition, type: OverlayType) => void }) {
  const isPhone = useIsPhone();
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
                  role={isPhone ? "button" : undefined}
                  onClick={isPhone && onAdd ? () => setPlacing(chip.type) : undefined}
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
      {isPhone && onAdd && (
        <ActionSheet
          open={placing !== null}
          onClose={() => setPlacing(null)}
          title="Place the badge"
          actions={POSITIONS.map((p) => ({ label: p.label, onSelect: () => placing && onAdd(p.id, placing) }))}
        />
      )}
    </aside>
  );
}
