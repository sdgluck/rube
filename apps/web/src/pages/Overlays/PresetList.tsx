import styles from "../Overlays.module.css";

interface PresetListProps {
  presets: Array<{ id: string; name: string; description: string; builtIn: boolean }>;
  onApply: (id: string) => void;
  onDelete: (id: string) => void;
  onSaveCurrent: () => void;
  canSave: boolean;
}

export function PresetList({ presets, onApply, onDelete, onSaveCurrent, canSave }: PresetListProps) {
  const builtIn = presets.filter((p) => p.builtIn);
  const userPresets = presets.filter((p) => !p.builtIn);

  return (
    <div className={styles.presetList}>
      {builtIn.length > 0 && <div className={styles.presetGroupLabel}>Built-in</div>}
      {builtIn.map((p) => (
        <button key={p.id} className={styles.presetItem} onClick={() => onApply(p.id)}>
          <span className={styles.presetItemName}>{p.name}</span>
          <span className={styles.presetItemDesc}>{p.description}</span>
        </button>
      ))}
      {userPresets.length > 0 && <div className={styles.presetGroupLabel}>Yours</div>}
      {userPresets.map((p) => (
        <div key={p.id} className={styles.presetRow}>
          <button className={styles.presetItem} onClick={() => onApply(p.id)}>
            <span className={styles.presetItemName}>{p.name}</span>
            <span className={styles.presetItemDesc}>{p.description}</span>
          </button>
          <button className={styles.iconBtn} onClick={() => onDelete(p.id)} title="Delete preset">
            ×
          </button>
        </div>
      ))}
      <button
        className={styles.presetSaveBtn}
        onClick={onSaveCurrent}
        disabled={!canSave}
        title={canSave ? "Save the current section's overlays as a preset" : "Add at least one overlay first"}
      >
        + Save current as preset…
      </button>
    </div>
  );
}
