import styles from "./StressTest.module.css";
import { CHART_W, linePath, niceScale, projectY } from "./chart.ts";
import { formatBandwidth } from "#/format";
import type { StressStep } from "./types.ts";

const CHART_H = 160;
/** The threshold `assess.ts` judges against: below realtime, a viewer buffers. */
const REALTIME = 1.0;

/**
 * The answer, as a curve: what the server did at each session count.
 *
 * Built from the step rows rather than the telemetry series, which is what lets
 * it draw for runs recorded before the series existed — those rows are all the
 * history there is, and a chart that only worked for runs made after today would
 * be the less useful half of this page.
 *
 * Session count on the x axis, not time. The two are nearly the same picture for
 * a healthy ramp and completely different for one that stalled, and "how many
 * streams" is the question the tool exists to answer.
 */
export default function CapacityCurve({ steps, degradedAt }: { steps: readonly StressStep[]; degradedAt?: number }) {
  const usable = steps.filter((s) => s.sessions > 0);
  if (usable.length < 2) return null;

  const maxSessions = Math.max(...usable.map((s) => s.sessions));
  const x = (sessions: number) => ((sessions - 1) / Math.max(1, maxSessions - 1)) * CHART_W;

  const speedScale = niceScale(
    usable.map((s) => s.avgTranscodeSpeed).filter((v): v is number => v != null),
    { include: [0, REALTIME] },
  );
  const kbpsScale = niceScale(usable.map(throughput), { include: [0] });

  const speedPath = linePath(
    usable.map((s) => ({
      x: x(s.sessions),
      y: s.avgTranscodeSpeed == null ? null : projectY(s.avgTranscodeSpeed, speedScale, CHART_H),
    })),
  );
  const kbpsPath = linePath(usable.map((s) => ({ x: x(s.sessions), y: projectY(throughput(s), kbpsScale, CHART_H) })));

  const hasSpeed = usable.some((s) => s.avgTranscodeSpeed != null);
  const realtimeY = projectY(REALTIME, speedScale, CHART_H);

  return (
    <section className={styles.chartCard}>
      <header className={styles.chartHead}>
        <h4 className={styles.chartTitle}>Capacity curve</h4>
        <div className={styles.legend}>
          {hasSpeed && (
            <span className={styles.legendItem}>
              <span className={`${styles.legendSwatch} ${styles.toneOne}`} />
              Encode speed
            </span>
          )}
          <span className={styles.legendItem}>
            <span className={`${styles.legendSwatch} ${styles.toneTwo}`} />
            Throughput
          </span>
        </div>
      </header>

      <div className={styles.chartPlot}>
        <svg
          className={styles.chartSvg}
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Capacity curve across ${maxSessions} sessions`}
        >
          {kbpsScale.ticks.map((tick) => (
            <line
              key={tick}
              className={styles.grid}
              x1={0}
              x2={CHART_W}
              y1={projectY(tick, kbpsScale, CHART_H)}
              y2={projectY(tick, kbpsScale, CHART_H)}
            />
          ))}

          {hasSpeed && realtimeY >= 0 && realtimeY <= CHART_H && (
            <line className={styles.threshold} x1={0} x2={CHART_W} y1={realtimeY} y2={realtimeY} />
          )}

          {degradedAt != null && (
            <line className={styles.degradedMark} x1={x(degradedAt)} x2={x(degradedAt)} y1={0} y2={CHART_H} />
          )}

          <g className={styles.toneTwo}>
            <path className={styles.seriesLine} d={kbpsPath} />
          </g>
          {hasSpeed && (
            <g className={styles.toneOne}>
              <path className={styles.seriesLine} d={speedPath} />
            </g>
          )}
        </svg>

        {hasSpeed && realtimeY >= 0 && realtimeY <= CHART_H && (
          <span className={styles.thresholdLabel} style={{ top: `${(realtimeY / CHART_H) * 100}%` }} aria-hidden="true">
            realtime
          </span>
        )}

        <div className={styles.pointRow} aria-hidden="true">
          {usable.map((step) => (
            <span
              key={step.step}
              className={styles.point}
              style={{ left: `${(x(step.sessions) / CHART_W) * 100}%` }}
              data-degraded={step.reason ? "true" : undefined}
              title={`${step.sessions} session(s): ${
                step.avgTranscodeSpeed != null ? `${step.avgTranscodeSpeed.toFixed(2)}x, ` : ""
              }${formatBandwidth(throughput(step))}${step.reason ? ` — ${step.reason}` : ""}`}
            />
          ))}
        </div>
      </div>

      <div className={styles.xAxis} aria-hidden="true">
        <span>1 session</span>
        <span>{maxSessions} sessions</span>
      </div>
    </section>
  );
}

/**
 * What the server was pushing at this step.
 *
 * `totalKbps` where it was recorded; otherwise the per-session mean scaled back
 * up by the session count, which is what a row written before the sum existed
 * can be made to say. Not exact — the mean was taken over the sessions Plex
 * reported rather than the sessions we started — but it is the same quantity,
 * and the alternative is drawing a load curve that falls as sessions rise.
 */
function throughput(step: StressStep): number {
  return step.totalKbps ?? step.avgBandwidth * (step.sessionsSeen ?? step.sessions);
}
