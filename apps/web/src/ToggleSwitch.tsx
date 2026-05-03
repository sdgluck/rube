import styles from "./ToggleSwitch.module.css";

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: "sm" | "md";
  disabled?: boolean;
}

export default function ToggleSwitch({ checked, onChange, size = "md", disabled }: ToggleSwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      className={`${styles.toggle} ${styles[size]}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      type="button"
    >
      <span className={styles.track} data-checked={String(checked)}>
        <span className={styles.thumb} />
      </span>
    </button>
  );
}
