import styles from "#pages/Stats/Stats.module.css";

/**
 * A row of columns, scaled to the largest of them.
 *
 * Deliberately smaller than a charting library: no axes, no grid, no tooltip
 * beyond the browser's own. What a panel-sized series has to answer is "when is
 * this busy" and "is today unusual", and both of those are shape. A reader who
 * needs the number for one bucket hovers it; a reader who needs all of them
 * wants the History panel, not a chart.
 *
 * An all-zero series still draws — as a row of floors rather than nothing —
 * because "nobody watched anything this week" is a real answer and an empty
 * panel body looks like a query that failed.
 */
export function BarChart({
  values,
  labelFor,
  captionFor,
  highlight,
}: {
  values: number[];
  /** Axis label under a bar. Return null for the ones that would crowd. */
  labelFor: (index: number) => string | null;
  /** The bar's title attribute — "Tue 12 Aug: 9 plays". */
  captionFor: (index: number, value: number) => string;
  /** Bars to draw in the accent colour — today, the current hour. */
  highlight?: (index: number) => boolean;
}) {
  const max = Math.max(...values, 0);

  return (
    <div className={styles.barChart}>
      <div className={styles.barChartBars}>
        {values.map((value, i) => (
          <div key={i} className={styles.barChartSlot} title={captionFor(i, value)}>
            <div
              className={styles.barChartBar}
              data-highlight={highlight?.(i) ? "true" : undefined}
              data-zero={value === 0 ? "true" : undefined}
              // A bar for a non-zero value never rounds to nothing: one play in
              // a week of hundreds is still the difference between "quiet" and
              // "dead", and it is the reading the bar exists to give.
              style={{ height: max > 0 && value > 0 ? `${Math.max((value / max) * 100, 6)}%` : undefined }}
            />
          </div>
        ))}
      </div>
      <div className={styles.barChartAxis}>
        {values.map((_, i) => (
          <span key={i} className={styles.barChartTick}>
            {labelFor(i)}
          </span>
        ))}
      </div>
    </div>
  );
}
