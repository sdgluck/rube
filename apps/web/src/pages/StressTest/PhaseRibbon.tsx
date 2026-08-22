import styles from "./StressTest.module.css";
import { formatOffset, phaseRuns } from "./chart.ts";
import type { StressSample } from "./types.ts";

const PHASE_LABEL: Record<StressSample["phase"], string> = {
  start: "starting",
  settle: "settling",
  measure: "measuring",
  confirm: "re-measuring",
  cleanup: "cleaning up",
};

/**
 * What the run was doing, under the charts that share its time axis.
 *
 * Most of a stress run is spent settling — fifteen seconds a step against six of
 * measurement — and without this the charts are long flat stretches that look
 * like the tool has hung. Naming the stretch turns dead air into "it is waiting
 * for the transcoder to stop reporting startup numbers", which is what it is.
 *
 * The re-measure band is the one worth spotting: it only appears when a step
 * looked degraded and the ramp went back to check, so it marks every reading the
 * run declined to believe on the first try.
 */
export default function PhaseRibbon({ samples }: { samples: readonly StressSample[] }) {
  if (samples.length < 2) return null;

  const from = samples[0].t;
  const to = samples.at(-1)!.t;
  const span = to - from || 1;
  const runs = phaseRuns(samples);

  return (
    <div className={styles.ribbon} role="img" aria-label={ribbonLabel(runs)}>
      {runs.map((run, i) => (
        <span
          key={`${run.phase}-${run.step}-${i}`}
          className={styles.ribbonBand}
          data-phase={run.phase}
          style={{
            left: `${((run.from - from) / span) * 100}%`,
            width: `${(Math.max(run.to - run.from, span * 0.004) / span) * 100}%`,
          }}
          title={`${PHASE_LABEL[run.phase]} · step ${run.step} · ${formatOffset(run.from)}`}
        />
      ))}
      {samples.map((sample, i) =>
        sample.err > 0 || sample.apiError ? (
          <span
            key={`e${i}`}
            className={styles.ribbonTick}
            data-kind={sample.apiError ? "api" : "stream"}
            style={{ left: `${((sample.t - from) / span) * 100}%` }}
            title={
              sample.apiError
                ? `Plex did not answer at ${formatOffset(sample.t)}`
                : `${sample.err} stream error(s) at ${formatOffset(sample.t)}`
            }
          />
        ) : null,
      )}
    </div>
  );
}

function ribbonLabel(runs: ReturnType<typeof phaseRuns>): string {
  const confirms = runs.filter((r) => r.phase === "confirm").length;
  return `Run phases${confirms > 0 ? `, including ${confirms} re-measurement${confirms === 1 ? "" : "s"}` : ""}`;
}
