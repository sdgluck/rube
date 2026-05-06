import type { ReactNode } from "react";
import UnsavedBanner from "#components/UnsavedBanner";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import styles from "#pages/Jobs/Jobs.module.css";

interface Props {
  children: ReactNode;
  /** When provided, renders the save footer. Omit for read-only / no-config jobs. */
  save?: { dirty: boolean; onSave: () => void };
}

export default function ConfigPanel({ children, save }: Props) {
  useUnsavedChanges(save?.dirty ?? false);

  return (
    <fieldset className={save ? styles.detailSectionCappedWithFooter : styles.detailSectionCapped}>
      <legend className={styles.detailSectionTitle}>Configuration</legend>
      <div className={styles.detailSectionScroll}>
        <table className={styles.configTable}>
          <tbody>{children}</tbody>
        </table>
      </div>
      {save && (
        <div className={styles.detailSectionFooter}>
          <button className={`${styles.button} ${styles.buttonSmall}`} onClick={save.onSave} disabled={!save.dirty}>
            Save Config
          </button>
          <UnsavedBanner visible={save.dirty} />
        </div>
      )}
    </fieldset>
  );
}
