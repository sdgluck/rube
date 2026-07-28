import styles from "./Spinner.module.css";

type Size = "xs" | "sm" | "md" | "lg";
type Variant = "default" | "subtle" | "inverse";

export default function Spinner({
  size = "sm",
  variant = "default",
  label = "Loading",
  className,
}: {
  size?: Size;
  variant?: Variant;
  label?: string;
  className?: string;
}) {
  const cls = [styles.spinner, styles[size], variant !== "default" && styles[variant], className]
    .filter(Boolean)
    .join(" ");
  return (
    // data-motion="essential" exempts this from the global reduced-motion
    // reset: a spinner that doesn't spin conveys nothing. Its reduced-motion
    // form is a gentler pulse rather than a rotation.
    <span className={cls} role="status" aria-live="polite" data-motion="essential">
      <span className={styles.label}>{label}</span>
    </span>
  );
}

export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className={styles.center}>
      <Spinner size="lg" label={label} />
    </div>
  );
}
