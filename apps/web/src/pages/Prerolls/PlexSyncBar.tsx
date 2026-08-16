import { Link } from "react-router-dom";
import controls from "#/styles/controls.module.css";
import type { PrerollMode, PrerollPlexStatus } from "./types";
import styles from "./Prerolls.module.css";

interface PlexSyncBarProps {
  enabledCount: number;
  mode: PrerollMode;
  status: PrerollPlexStatus | undefined;
  syncing: boolean;
  onModeChange: (mode: PrerollMode) => void;
  onSync: () => void;
}

/**
 * The bar above the grid, and the only place that says out loud whether Plex is
 * actually playing what this page shows. Everything below it is Tinkerbell's
 * own state; this is the part that can silently diverge.
 */
export default function PlexSyncBar({ enabledCount, mode, status, syncing, onModeChange, onSync }: PlexSyncBarProps) {
  const unreachable = status && "error" in status && Boolean(status.error);
  const inSync = status?.inSync === true;

  return (
    <div className={styles.syncBar}>
      <div className={styles.syncSummary}>
        <strong>{enabledCount}</strong>
        <span>{enabledCount === 1 ? "preroll enabled" : "prerolls enabled"}</span>
      </div>

      <div className={styles.modeToggle} role="group" aria-label="Playback order">
        <button
          type="button"
          className={mode === "random" ? styles.modeButtonActive : styles.modeButton}
          onClick={() => onModeChange("random")}
          title="Plex picks one preroll at random before each movie"
        >
          Random
        </button>
        <button
          type="button"
          className={mode === "sequential" ? styles.modeButtonActive : styles.modeButton}
          onClick={() => onModeChange("sequential")}
          title="Plex plays every enabled preroll, in order, before each movie"
        >
          In order
        </button>
      </div>

      <p className={styles.syncStatus} data-tone={unreachable ? "error" : inSync ? "ok" : "warn"}>
        {unreachable ? (
          <>Can't reach Plex — {(status as { error?: string }).error}</>
        ) : inSync ? (
          "In sync with Plex"
        ) : (
          <>
            Plex hasn't got these yet. <Link to="/settings/prerolls">Check the path mapping</Link> if applying doesn't
            stick.
          </>
        )}
      </p>

      <button
        type="button"
        className={`${controls.btn} ${inSync ? controls.btnSecondary : controls.btnPrimary}`}
        onClick={onSync}
        disabled={syncing}
      >
        {syncing ? "Applying…" : "Apply to Plex"}
      </button>
    </div>
  );
}
