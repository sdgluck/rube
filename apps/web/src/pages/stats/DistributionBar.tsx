import styles from "../Stats.module.css";

export const RESOLUTION_COLORS: Record<string, string> = {
  "4k": "#7c4dff",
  "1080": "#4a6cf7",
  "720": "#28a745",
  "480": "#f5c518",
  sd: "#888",
};

const CODEC_COLORS = ["#7c4dff", "#4a6cf7", "#28a745", "#f5c518", "#ef4444", "#888"];

export interface DistItem {
  value: string | null;
  count: number;
}

export function DistributionBar({
  label,
  items,
  colorMap,
  formatLabel,
}: {
  label: string;
  items: DistItem[];
  colorMap?: Record<string, string>;
  formatLabel?: (v: string) => string;
}) {
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
              title={`${displayLabel}: ${item.count} (${pct.toFixed(1)}%)`}
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
              <span className={styles.distLegendCount}>{item.count}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
