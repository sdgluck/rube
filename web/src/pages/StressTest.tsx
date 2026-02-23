import { useState } from "react";
import { trpc } from "../trpc";
import styles from "./StressTest.module.css";
import shared from "./Collections.module.css";

function formatDuration(startedAt: number, finishedAt: number | null): string {
  if (!finishedAt) return "...";
  const seconds = Math.round((finishedAt - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

function SpeedCell({ speed }: { speed: number | null }) {
  if (speed == null) return <span style={{ color: "#999" }}>n/a</span>;
  const cls = speed >= 1.0 ? styles.speedGood : speed >= 0.7 ? styles.speedWarn : styles.speedBad;
  return (
    <span className={styles.speedBar}>
      <span className={`${styles.speedIndicator} ${cls}`} />
      {speed.toFixed(2)}x
    </span>
  );
}

export default function StressTest() {
  const utils = trpc.useUtils();
  const runsQuery = trpc.stressTest.runs.useQuery();
  const activeRunQuery = trpc.stressTest.activeRun.useQuery(undefined, { refetchInterval: 2000 });
  const startMutation = trpc.stressTest.start.useMutation({
    onSuccess: () => {
      utils.stressTest.activeRun.invalidate();
    },
  });
  const cancelMutation = trpc.stressTest.cancel.useMutation({
    onSuccess: () => {
      utils.stressTest.activeRun.invalidate();
      utils.stressTest.runs.invalidate();
    },
  });

  const [showConfig, setShowConfig] = useState(false);
  const [mode, setMode] = useState<"transcode" | "directplay" | "mixed">("transcode");
  const [transcodePct, setTranscodePct] = useState(50);
  const [maxSessions, setMaxSessions] = useState(20);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const selectedRunQuery = trpc.stressTest.run.useQuery(
    { id: selectedRunId! },
    { enabled: !!selectedRunId, refetchInterval: selectedRunId ? 5000 : false },
  );

  const stressTestRun = activeRunQuery.data;
  const isRunning = !!stressTestRun;

  async function handleStart() {
    const input: { mode: typeof mode; maxSessions: number; transcodePct?: number } = { mode, maxSessions };
    if (mode === "mixed") input.transcodePct = transcodePct;
    await startMutation.mutateAsync(input);
    setShowConfig(false);
  }

  const runs = runsQuery.data ?? [];
  const selectedRun = selectedRunQuery.data;

  return (
    <div>
      <div className={styles.header}>
        {!isRunning && (
          <button className={shared.button} onClick={() => setShowConfig(!showConfig)}>
            {showConfig ? "Cancel" : "Run Test"}
          </button>
        )}
      </div>

      {showConfig && !isRunning && (
        <div className={styles.configForm}>
          <div className={styles.formGroup}>
            <label>Mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="transcode">Transcode</option>
              <option value="directplay">Direct Play</option>
              <option value="mixed">Mixed</option>
            </select>
          </div>
          {mode === "mixed" && (
            <div className={styles.formGroup}>
              <label>Transcode %</label>
              <input
                type="number"
                min={0}
                max={100}
                value={transcodePct}
                onChange={(e) => setTranscodePct(Number(e.target.value))}
                style={{ width: 70 }}
              />
            </div>
          )}
          <div className={styles.formGroup}>
            <label>Max Sessions</label>
            <input
              type="number"
              min={1}
              max={50}
              value={maxSessions}
              onChange={(e) => setMaxSessions(Number(e.target.value))}
              style={{ width: 70 }}
            />
          </div>
          <button className={shared.button} onClick={handleStart} disabled={startMutation.isPending}>
            Start
          </button>
        </div>
      )}

      {isRunning && stressTestRun && (
        <div className={styles.activeBanner}>
          <div className={styles.bannerSpinner} />
          <span className={styles.bannerText}>Stress test in progress</span>
          {stressTestRun.progress > 0 && (
            <>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${Math.round(stressTestRun.progress * 100)}%` }}
                />
              </div>
              <span className={styles.bannerProgress}>{Math.round(stressTestRun.progress * 100)}%</span>
            </>
          )}
          {stressTestRun.message && <span className={styles.bannerProgress}>{stressTestRun.message}</span>}
          <button className={styles.cancelButton} onClick={() => cancelMutation.mutate()}>
            Cancel
          </button>
        </div>
      )}

      {selectedRun && (
        <div>
          <div className={styles.resultCard}>
            <div className={styles.resultLabel}>Max Supported</div>
            <div className={styles.resultNumber}>
              {selectedRun.maxSessions ?? "?"}
              <span className={styles.resultUnit}>sessions</span>
            </div>
            <div className={styles.configBadges}>
              <span className={styles.badge}>{selectedRun.config.mode}</span>
              {selectedRun.config.mode === "mixed" && (
                <span className={styles.badge}>{selectedRun.config.transcodePct ?? 50}% transcode</span>
              )}
            </div>
          </div>

          <h2 className={styles.sectionTitle}>Steps</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Step</th>
                <th>Sessions</th>
                <th>Transcode Speed</th>
                <th>Bandwidth</th>
                <th>Errors</th>
              </tr>
            </thead>
            <tbody>
              {selectedRun.steps.map((step, i) => {
                const isLast = i === selectedRun.steps.length - 1;
                const isFailed =
                  isLast && ((step.avgTranscodeSpeed != null && step.avgTranscodeSpeed < 1.0) || step.errors > 0);
                return (
                  <tr key={step.step} className={isFailed ? styles.stepFailed : ""}>
                    <td>{step.step}</td>
                    <td>{step.sessions}</td>
                    <td>
                      <SpeedCell speed={step.avgTranscodeSpeed} />
                    </td>
                    <td>{step.avgBandwidth > 0 ? `${step.avgBandwidth} kbps` : "n/a"}</td>
                    <td>{step.errors}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.runsSection}>
        <h2 className={styles.sectionTitle}>Past Runs</h2>
        {runs.length === 0 ? (
          <div className={styles.emptyState}>No stress test runs yet. Click "Run Test" to start one.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Mode</th>
                <th>Max Sessions</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className={`${styles.clickableRow} ${selectedRunId === run.id ? styles.selectedRow : ""}`}
                  onClick={() => setSelectedRunId(run.id === selectedRunId ? null : run.id)}
                >
                  <td>{formatDate(run.startedAt)}</td>
                  <td>
                    <span className={styles.badge}>{run.config.mode}</span>
                  </td>
                  <td>{run.maxSessions ?? "?"}</td>
                  <td className={styles.duration}>{formatDuration(run.startedAt, run.finishedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
