import { useId, useMemo, useState } from "react";
import styles from "./StressTest.module.css";
import { CHART_W, bandPath, formatOffset, linePath, nearestIndex, niceScale, projectX, projectY } from "./chart.ts";
import type { Scale } from "./chart.ts";
import type { StressSample } from "./types.ts";

const CHART_H = 180;

export interface TimeSeries {
  key: string;
  label: string;
  value: (s: StressSample) => number | null;
  /** Lower edge of a filled band under `value` — the slowest single session. */
  band?: (s: StressSample) => number | null;
  /** A class, never a colour prop: colours live in CSS so they follow the theme. */
  tone: "one" | "two";
  format: (v: number) => string;
}

interface TimeChartProps {
  title: string;
  samples: readonly StressSample[];
  series: readonly TimeSeries[];
  /** Values the axis must contain whatever the data did — zero, the threshold. */
  include?: number[];
  threshold?: { value: number; label: string };
  /** Axis labels. Given the top of the scale so every tick can share a unit. */
  format: (v: number, max: number) => string;
  /** Shown in place of the chart before there is anything to draw. */
  emptyText: string;
}

/**
 * A multi-series time chart, drawn twice: bandwidth and encode speed.
 *
 * Two decisions worth stating, because both were the alternative on the first
 * pass and both are wrong.
 *
 * **No measurement.** The SVG is a fixed 1000-wide viewBox stretched to the
 * container, with `vector-effect: non-scaling-stroke` keeping the lines an even
 * weight — so there is no ResizeObserver, no layout read, and no first frame
 * drawn at the wrong size. The cost is that nothing inside the SVG may be text,
 * because text would stretch with it; every label is an HTML element positioned
 * over the top instead, which is also how the crosshair readout gets to be a
 * real element rather than a `<title>`.
 *
 * **No colour props.** A series names a tone and CSS paints it. The two existing
 * charts in this app that took colours in TypeScript — `DistributionBar` and the
 * health strip — both hardcode hexes to get around stylelint's `color-no-hex`,
 * and the consequence is that neither has ever themed: in dark mode they still
 * draw the light palette.
 */
export default function TimeChart({
  title,
  samples,
  series,
  include = [0],
  threshold,
  format,
  emptyText,
}: TimeChartProps) {
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const model = useMemo(() => {
    if (samples.length < 2) return null;
    const from = samples[0].t;
    const to = samples.at(-1)!.t;

    const values: number[] = [];
    for (const s of samples) {
      for (const line of series) {
        const v = line.value(s);
        if (v != null) values.push(v);
        const b = line.band?.(s);
        if (b != null) values.push(b);
      }
    }

    const scale = niceScale(values, { include: [...include, ...(threshold ? [threshold.value] : [])] });
    const x = (t: number) => projectX(t, from, to);
    const y = (v: number) => projectY(v, scale, CHART_H);

    return {
      from,
      to,
      scale,
      times: samples.map((s) => s.t),
      paths: series.map((line) => ({
        line,
        d: linePath(samples.map((s) => ({ x: x(s.t), y: nullableY(line.value(s), y) }))),
        band: line.band
          ? bandPath(
              samples.map((s) => ({
                x: x(s.t),
                hi: nullableY(line.value(s), y),
                lo: nullableY(line.band!(s), y),
              })),
            )
          : "",
      })),
      // A failed `/status/sessions` call is a gap in what we know, and drawing
      // it as a shaded column is the difference between "the server went quiet"
      // and "we stopped being able to ask".
      blind: samples.filter((s) => s.apiError).map((s) => x(s.t)),
      x,
      y,
    };
  }, [samples, series, include, threshold]);

  if (!model) {
    return (
      <section className={styles.chartCard}>
        <h4 className={styles.chartTitle}>{title}</h4>
        <div className={styles.chartEmpty}>{emptyText}</div>
      </section>
    );
  }

  const { scale, times, paths, blind, x, y } = model;
  const active = hover != null ? samples[hover] : null;
  const span = model.to - model.from || 1;

  return (
    <section className={styles.chartCard}>
      <header className={styles.chartHead}>
        <h4 className={styles.chartTitle}>{title}</h4>
        <div className={styles.legend}>
          {series.map((line) => (
            <span key={line.key} className={styles.legendItem}>
              <span className={`${styles.legendSwatch} ${line.tone === "one" ? styles.toneOne : styles.toneTwo}`} />
              {line.label}
              <span className={styles.legendValue}>{readout(line, active, samples)}</span>
            </span>
          ))}
        </div>
      </header>

      <div
        className={styles.chartPlot}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const fraction = (e.clientX - box.left) / (box.width || 1);
          setHover(nearestIndex(times, model.from + fraction * span));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          className={styles.chartSvg}
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${title}. ${describe(series, samples.at(-1)!)}`}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={0} y={0} width={CHART_W} height={CHART_H} />
            </clipPath>
          </defs>

          {scale.ticks.map((tick) => (
            <line key={tick} className={styles.grid} x1={0} x2={CHART_W} y1={y(tick)} y2={y(tick)} />
          ))}

          {blind.map((cx, i) => (
            <rect key={i} className={styles.blindSpot} x={cx - 3} y={0} width={6} height={CHART_H} />
          ))}

          {threshold && threshold.value >= scale.min && threshold.value <= scale.max && (
            <line className={styles.threshold} x1={0} x2={CHART_W} y1={y(threshold.value)} y2={y(threshold.value)} />
          )}

          <g clipPath={`url(#${clipId})`}>
            {paths.map(({ line, d, band }) => (
              <g key={line.key} className={line.tone === "one" ? styles.toneOne : styles.toneTwo}>
                {band && <path className={styles.bandFill} d={band} />}
                <path className={styles.seriesLine} d={d} />
              </g>
            ))}
          </g>

          {active && <line className={styles.crosshair} x1={x(active.t)} x2={x(active.t)} y1={0} y2={CHART_H} />}
        </svg>

        {/* Labels are HTML, not SVG text: the viewBox is stretched to the
            container, and anything inside it stretches with it. */}
        <div className={styles.yAxis} aria-hidden="true">
          {scale.ticks.map((tick) => (
            <span key={tick} className={styles.yTick} style={{ top: `${(y(tick) / CHART_H) * 100}%` }}>
              {format(tick, scale.max)}
            </span>
          ))}
        </div>

        {threshold && threshold.value >= scale.min && threshold.value <= scale.max && (
          <span
            className={styles.thresholdLabel}
            style={{ top: `${(y(threshold.value) / CHART_H) * 100}%` }}
            aria-hidden="true"
          >
            {threshold.label}
          </span>
        )}

        {active && (
          <div
            className={styles.readout}
            style={{ left: `${(x(active.t) / CHART_W) * 100}%` }}
            data-side={x(active.t) > CHART_W * 0.6 ? "left" : "right"}
          >
            <div className={styles.readoutTime}>
              {formatOffset(active.t)} · {active.started} session{active.started === 1 ? "" : "s"}
            </div>
            {series.map((line) => (
              <div key={line.key} className={styles.readoutRow}>
                <span className={`${styles.legendSwatch} ${line.tone === "one" ? styles.toneOne : styles.toneTwo}`} />
                {line.label}
                <span className={styles.readoutValue}>
                  {line.value(active) != null ? line.format(line.value(active)!) : "—"}
                </span>
              </div>
            ))}
            {active.apiError && <div className={styles.readoutWarn}>Plex did not answer</div>}
          </div>
        )}
      </div>

      <div className={styles.xAxis} aria-hidden="true">
        <span>{formatOffset(model.from)}</span>
        <span>{formatOffset(model.from + span / 2)}</span>
        <span>{formatOffset(model.to)}</span>
      </div>
    </section>
  );
}

function nullableY(value: number | null, y: (v: number) => number): number | null {
  return value == null ? null : y(value);
}

/**
 * The legend's number: what the pointer is over, or the last reading there was.
 *
 * "The last sample" is not the same as "the last reading". A finished run's
 * final samples are taken during cleanup with every session already stopped, so
 * reading them out leaves a completed run's legend saying 0 kbps — which looks
 * like the chart above it failed to load rather than like a run that ended.
 */
function readout(line: TimeSeries, active: StressSample | null, samples: readonly StressSample[]): string {
  if (active) {
    const value = line.value(active);
    return value != null ? line.format(value) : "—";
  }
  for (let i = samples.length - 1; i >= 0; i--) {
    const value = line.value(samples[i]);
    if (value != null && value !== 0) return line.format(value);
  }
  return "—";
}

/** The chart's contents for a screen reader, since the drawing carries none. */
function describe(series: readonly TimeSeries[], latest: StressSample): string {
  return series
    .map((line) => {
      const value = line.value(latest);
      return `${line.label}: ${value != null ? line.format(value) : "no reading"}`;
    })
    .join(", ");
}

export type { Scale };
