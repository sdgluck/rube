import styles from "./UnsavedBanner.module.css";

interface Props {
  visible: boolean;
}

export default function UnsavedBanner({ visible }: Props) {
  if (!visible) return null;

  return (
    <span className={styles.banner}>
      <span className={styles.dot} />
      Unsaved changes
    </span>
  );
}
