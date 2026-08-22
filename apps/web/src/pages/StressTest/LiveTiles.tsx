import styles from "./StressTest.module.css";
import { formatBandwidth } from "#/format";
import type { StressSample } from "./types.ts";

/**
 * The numbers you want without reading a chart: how much load is on, how much
 * is coming back, and whether anything is going wrong.
 *
 * Every tile is a *pair* where a pair exists — sessions started against sessions
 * Plex admits to, bandwidth reported against bandwidth received. Each of those
 * gaps is a distinct failure the harness can see and a single figure cannot:
 * a server quietly reaping streams, and a server claiming to serve one it is not
 * delivering. Both were invisible on this page before.
 */
export default function LiveTiles({
  samples,
  elapsedMs,
  step,
  maxSessions,
}: {
  samples: readonly StressSample[];
  elapsedMs: number;
  step: number;
  maxSessions: number;
}) {
  const latest = samples.at(-1);
  // The newest sample can be mid-cleanup or a failed query. Falling back to the
  // last one that actually read something keeps the tiles from blanking on a
  // single blind moment.
  const lastGood = [...samples].reverse().find((s) => !s.apiError) ?? latest;
  const errors = samples.reduce((n, s) => n + s.err, 0);
  const apiErrors = samples.reduce((n, s) => n + (s.apiError ? 1 : 0), 0);
  const speeds = samples.map((s) => s.speedMin).filter((v): v is number => v != null);

  const started = latest?.started ?? 0;
  const seen = lastGood?.seen ?? 0;

  return (
    <div className={styles.tiles}>
      <Tile
        label="Sessions"
        value={String(started)}
        sub={seen === started ? `all ${started} visible to Plex` : `${seen} visible to Plex`}
        tone={seen < started ? "warn" : undefined}
      />
      <Tile
        label="Throughput"
        value={formatBandwidth(lastGood?.kbps ?? 0)}
        sub={`${formatBandwidth(lastGood?.actualKbps ?? 0)} received`}
      />
      <Tile
        label="Encode speed"
        value={lastGood?.speed != null ? `${lastGood.speed.toFixed(2)}x` : "—"}
        sub={speeds.length > 0 ? `slowest this run ${Math.min(...speeds).toFixed(2)}x` : "no transcoder in this mode"}
        tone={lastGood?.speed != null && lastGood.speed < 1 ? "bad" : undefined}
      />
      <Tile
        label="Errors"
        value={String(errors + apiErrors)}
        sub={apiErrors > 0 ? `${apiErrors} unanswered by Plex` : "streams and samples"}
        tone={errors + apiErrors > 0 ? "warn" : undefined}
      />
      <Tile label="Elapsed" value={clock(elapsedMs)} sub={`step ${step} of ${maxSessions}`} />
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "warn" | "bad" }) {
  return (
    <div className={styles.tile} data-tone={tone}>
      <div className={styles.tileLabel}>{label}</div>
      <div className={styles.tileValue}>{value}</div>
      <div className={styles.tileSub}>{sub}</div>
    </div>
  );
}

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
