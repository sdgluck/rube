import { Sparkline } from "#components/dashboard";
import styles from "./StressTest.module.css";
import { lanes } from "./chart.ts";
import { formatBandwidth } from "#/format";
import type { StressSample } from "./types.ts";

/**
 * One row per simulated session, live or dead.
 *
 * The aggregate charts answer "is the server keeping up"; this answers "which
 * stream is the one that isn't". Nine healthy transcodes and one stalled at 0.4x
 * average out to comfortably above realtime, and the run's own verdict works off
 * that average — so the case where a server degrades by picking a victim rather
 * than slowing uniformly is one the summary genuinely cannot show.
 *
 * Sessions that have ended stay, greyed. The ramp's cleanup ends all of them, so
 * a panel that dropped them would empty itself at exactly the moment the run
 * finished and there was something to read.
 */
export default function SessionLanes({ samples }: { samples: readonly StressSample[] }) {
  const rows = lanes(samples);
  if (rows.length === 0) return null;

  return (
    <section className={styles.lanesCard}>
      <h4 className={styles.chartTitle}>Sessions</h4>
      <ul className={styles.lanes}>
        {rows.map((lane) => (
          <li key={lane.id} className={styles.lane} data-dead={lane.live ? undefined : "true"}>
            <span className={styles.laneId}>{lane.id}</span>
            <span className={styles.laneDecision}>{lane.decision ?? "—"}</span>
            {lane.hw && (
              <span className={styles.laneHw} title="Hardware encoder">
                hw
              </span>
            )}
            <span className={styles.laneSpark}>
              {lane.speeds.length > 1 && <Sparkline values={lane.speeds} label={`${lane.id} encode speed`} />}
            </span>
            <span className={styles.laneSpeed} data-slow={lane.speed != null && lane.speed < 1 ? "true" : undefined}>
              {lane.speed != null ? `${lane.speed.toFixed(2)}x` : "—"}
            </span>
            <span className={styles.laneBw}>{formatBandwidth(lane.kbps)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
