import { useMemo } from "react";
import styles from "./StressTest.module.css";
import TimeChart, { type TimeSeries } from "./TimeChart.tsx";
import PhaseRibbon from "./PhaseRibbon.tsx";
import SessionLanes from "./SessionLanes.tsx";
import CapacityCurve from "./CapacityCurve.tsx";
import LiveTiles from "./LiveTiles.tsx";
import { formatBandwidth } from "#/format";
import { bandwidthAxis } from "./chart.ts";
import type { StressSample, StressStep } from "./types.ts";

/**
 * Two lines, and the gap between them is the reading.
 *
 * `kbps` is what Plex says it is sending; `actualKbps` is what the simulated
 * clients got. A server under real pressure keeps reporting the stream long
 * after it stops delivering it, and that divergence is invisible in either
 * figure alone — which is why the page draws both rather than picking the more
 * authoritative-sounding one.
 */
const BANDWIDTH_SERIES: TimeSeries[] = [
  {
    key: "reported",
    label: "Reported",
    value: (s) => s.kbps,
    tone: "one",
    format: formatBandwidth,
  },
  {
    key: "actual",
    label: "Received",
    value: (s) => s.actualKbps,
    tone: "two",
    format: formatBandwidth,
  },
];

/**
 * Mean encode speed, with the slowest single session shaded beneath it.
 *
 * The band is the point. `assess.ts` judges the mean, and a server that degrades
 * by picking one stream to starve rather than slowing all of them keeps a
 * healthy mean the whole way down — so the band opening up is the earliest
 * visible sign of a failure mode the verdict does not have a rule for.
 */
const SPEED_SERIES: TimeSeries[] = [
  {
    key: "speed",
    label: "Mean",
    value: (s) => s.speed,
    band: (s) => s.speedMin,
    tone: "one",
    format: (v) => `${v.toFixed(2)}x`,
  },
];

export default function Cockpit({
  samples,
  steps,
  live,
  elapsedMs,
  step,
  maxSessions,
  log,
}: {
  samples: readonly StressSample[];
  steps: readonly StressStep[];
  live: boolean;
  elapsedMs: number;
  step: number;
  maxSessions: number;
  log?: React.ReactNode;
}) {
  const degradedAt = useMemo(() => steps.find((s) => s.reason)?.sessions, [steps]);
  const hasTranscode = samples.some((s) => s.speed != null) || steps.some((s) => s.avgTranscodeSpeed != null);

  return (
    <div className={styles.cockpit} data-live={live ? "true" : undefined}>
      {live && <LiveTiles samples={samples} elapsedMs={elapsedMs} step={step} maxSessions={maxSessions} />}

      <div className={styles.charts}>
        <TimeChart
          title="Bandwidth"
          samples={samples}
          series={BANDWIDTH_SERIES}
          format={(value, max) => bandwidthAxis(max)(value)}
          emptyText="Waiting for the first sessions to start streaming."
        />
        {hasTranscode && (
          <TimeChart
            title="Encode speed"
            samples={samples}
            series={SPEED_SERIES}
            include={[0, 1]}
            threshold={{ value: 1, label: "realtime" }}
            format={(v) => `${v.toFixed(1)}x`}
            emptyText="Waiting for the transcoder to report a speed."
          />
        )}
      </div>

      <PhaseRibbon samples={samples} />

      <div className={styles.cockpitLower}>
        <SessionLanes samples={samples} />
        {log}
      </div>

      <CapacityCurve steps={steps} degradedAt={degradedAt} />
    </div>
  );
}
