import styles from "#pages/Stats/Stats.module.css";

/* Distributions and rankings step down one hue rather than reaching for six
 * unrelated ones — the ordering is the information, not the categories. */
const RAMP = ["#12867c", "#5cb8ae", "#9fd8d1", "#d3e9e6"];
const RAMP_TAIL = "#c3cecc";

export const RESOLUTION_COLORS: Record<string, string> = {
  "4k": RAMP[0],
  "1080": RAMP[1],
  "720": RAMP[2],
  "480": RAMP[3],
  sd: RAMP_TAIL,
};

const CODEC_COLORS = [...RAMP, RAMP_TAIL];

export interface DistItem {
  value: string | null;
  count: number;
}

export function DistributionBar({
  label,
  items,
  colorMap,
  formatLabel,
  formatCount,
}: {
  label: string;
  items: DistItem[];
  colorMap?: Record<string, string>;
  formatLabel?: (v: string) => string;
  /** For distributions measured in something other than items — bytes, say. */
  formatCount?: (n: number) => string;
}) {
  const renderCount = formatCount ?? ((n: number) => String(n));
  const sorted = [...items].sort((a, b) => b.count - a.count);
  const total = sorted.reduce((s, i) => s + i.count, 0);
  if (total === 0) return null;

  return (
    <div className={styles.distRow}>
      <span className={styles.distLabel}>{label}</span>
      <div className={styles.distBar}>
        {sorted.map((item, i) => {
          const pct = (item.count / total) * 100;
          if (pct < 1) return null;
          const color = colorMap?.[item.value ?? ""] ?? CODEC_COLORS[i % CODEC_COLORS.length];
          const displayLabel = formatLabel ? formatLabel(item.value ?? "") : (item.value ?? "?");
          return (
            <div
              key={item.value ?? i}
              className={styles.distSegment}
              style={{ width: `${pct}%`, background: color }}
              title={`${displayLabel}: ${renderCount(item.count)} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className={styles.distLegend}>
        {sorted.slice(0, 5).map((item, i) => {
          const color = colorMap?.[item.value ?? ""] ?? CODEC_COLORS[i % CODEC_COLORS.length];
          const displayLabel = formatLabel ? formatLabel(item.value ?? "") : (item.value ?? "?");
          return (
            <span key={item.value ?? i} className={styles.distLegendItem}>
              <span className={styles.distLegendDot} style={{ background: color }} />
              {displayLabel}
              <span className={styles.distLegendCount}>{renderCount(item.count)}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
