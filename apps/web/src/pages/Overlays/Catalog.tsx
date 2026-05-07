import styles from "../Overlays.module.css";
import { OVERLAY_CATALOG } from "./constants";
import { badgePreviewStyle } from "./helpers";

export function Catalog() {
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
    </aside>
  );
}
