import styles from "./Dashboard.module.css";

const WIDTH = 44;
const HEIGHT = 14;

/**
 * A metric's recent shape, drawn small enough to sit on a tile's value line.
 *
 * Deliberately unlabelled and unscaled: at 44×14 there is no room for an axis,
 * and a number that needs one belongs in the value or the sub line. What this
 * carries is the thing neither of those can — whether today is a spike, a
 * trough, or Tuesday.
 *
 * A flat series draws along the bottom rather than through the middle. Zero
 * plays for a fortnight is a real shape, and centring it would draw the same
 * line as a steady twelve a day.
 */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min;
  const x = (i: number) => 1 + (i / (values.length - 1)) * (WIDTH - 2);
  const y = (v: number) => (span === 0 ? HEIGHT - 1 : HEIGHT - 1 - ((v - min) / span) * (HEIGHT - 2));

  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const lastIndex = values.length - 1;

  return (
    <svg
      className={styles.sparkline}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label={label}
    >
      <polyline className={styles.sparklineLine} points={points} />
      <circle className={styles.sparklineHead} cx={x(lastIndex)} cy={y(values[lastIndex])} r={1.6} />
    </svg>
  );
}
