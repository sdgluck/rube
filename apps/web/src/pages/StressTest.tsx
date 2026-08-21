import { useState, useRef, useEffect } from "react";
import { trpc } from "#/trpc";
import Spinner from "#components/Spinner";
import { useToast } from "#components/Toast";
import SettingsPageHeader from "./Settings/SettingsPageHeader";
import styles from "./StressTest.module.css";
import shared from "#/styles/shared.module.css";
import { EMPTY, formatElapsed, formatTime } from "#/format";
import SortableTh from "#components/SortableTh";
import { useLocalSort } from "#hooks/useLocalSort";

function SpeedCell({ speed }: { speed: number | null }) {
  if (speed == null) return <span className={styles.speedNone}>{EMPTY}</span>;
  const cls = speed >= 1.0 ? styles.speedGood : speed >= 0.7 ? styles.speedWarn : styles.speedBad;
  return (
    <span className={styles.speedBar}>
      <span className={`${styles.speedIndicator} ${cls}`} />
      {speed.toFixed(2)}x
    </span>
  );
}

/**
 * A run's outcome, which the table used to omit entirely — so a failed run was
 * indistinguishable from a successful one apart from a "?" in the max column.
 * That is part of why a total outage of this feature went unnoticed for months.
 */
function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "completed"
      ? shared.runBadgeOk
      : status === "failed"
        ? shared.runBadgeError
        : status === "cancelled"
          ? shared.runBadgeCancelled
          : shared.runBadgeBusy;
  return <span className={`${shared.runBadge} ${cls}`}>{status}</span>;
}

export default function StressTest() {
  const utils = trpc.useUtils();
  const { addToast } = useToast();
  const runsQuery = trpc.stressTest.runs.useQuery();
  const activeRunQuery = trpc.stressTest.activeRun.useQuery(undefined, { refetchInterval: 2000 });
  const startMutation = trpc.stressTest.start.useMutation({
    onSuccess: () => {
      utils.stressTest.activeRun.invalidate();
      utils.stressTest.runs.invalidate();
    },
    // "A stress test is already running" and "Plex URL and token are not
    // configured" both arrive here. They used to reject unhandled out of the
    // click handler, so pressing Start simply did nothing visible.
    onError: (err) => addToast(err.message, "error"),
  });
  const cancelMutation = trpc.stressTest.cancel.useMutation({
    onSuccess: () => {
      utils.stressTest.activeRun.invalidate();
      utils.stressTest.runs.invalidate();
    },
    onError: (err) => addToast(err.message, "error"),
  });

  const [showConfig, setShowConfig] = useState(false);
  const [mode, setMode] = useState<"transcode" | "directplay" | "mixed">("transcode");
  const [transcodePct, setTranscodePct] = useState(50);
  const [maxSessions, setMaxSessions] = useState(20);
  const [verbose, setVerbose] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const selectedRunQuery = trpc.stressTest.run.useQuery(
    { id: selectedRunId! },
    { enabled: !!selectedRunId, refetchInterval: selectedRunId ? 5000 : false },
  );

  const stressTestRun = activeRunQuery.data;
  const isRunning = !!stressTestRun;
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [stressTestRun?.log]);

  // A run that finishes on its own only shows up as the active run going away.
  // Without this the banner vanished and Past Runs stayed stale until a manual
  // refresh, which is the moment you most want to see the result.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !isRunning) {
      utils.stressTest.runs.invalidate();
      if (selectedRunId) utils.stressTest.run.invalidate({ id: selectedRunId });
    }
    wasRunning.current = isRunning;
  }, [isRunning, selectedRunId, utils]);

  function handleStart() {
    const input: { mode: typeof mode; maxSessions: number; transcodePct?: number; verbose?: boolean } = {
      mode,
      maxSessions,
    };
    if (mode === "mixed") input.transcodePct = transcodePct;
    if (verbose) input.verbose = true;
    startMutation.mutate(input, { onSuccess: () => setShowConfig(false) });
  }

  const runs = runsQuery.data ?? [];

  const {
    sortKey: runSortKey,
    sortDir: runSortDir,
    toggleSort: toggleRunSort,
    sorted: sortedRuns,
  } = useLocalSort({
    rows: runs,
    accessors: {
      startedAt: (r) => r.startedAt,
      mode: (r) => r.config.mode,
      status: (r) => r.status,
      maxSessions: (r) => r.maxSessions,
      duration: (r) => (r.finishedAt ? r.finishedAt - r.startedAt : null),
    },
    defaultKey: "startedAt",
    defaultDir: "desc",
    descFirst: ["startedAt", "maxSessions", "duration"],
  });
  const selectedRun = selectedRunQuery.data;

  const {
    sortKey: stepSortKey,
    sortDir: stepSortDir,
    toggleSort: toggleStepSort,
    sorted: sortedSteps,
  } = useLocalSort({
    rows: selectedRun?.steps ?? [],
    accessors: {
      step: (s) => s.step,
      sessions: (s) => s.sessions,
      avgTranscodeSpeed: (s) => s.avgTranscodeSpeed,
      avgBandwidth: (s) => s.avgBandwidth,
      errors: (s) => s.errors,
    },
    defaultKey: "step",
    descFirst: ["sessions", "avgBandwidth", "errors"],
  });
  const lastStepNumber = selectedRun?.steps.reduce((max, s) => Math.max(max, s.step), 0) ?? 0;

  return (
    <div>
      <SettingsPageHeader title="Stress Test" />

      <div className={styles.caution}>
        <div>
          <div className={styles.cautionTitle}>This puts real load on your Plex server.</div>
          Each step starts a genuine playback session and pulls the stream, one more at a time, until the server stops
          keeping up. Expect transcoding, disk and network load for the duration, and don't run it while other people
          are watching. Only never-watched items are used, and the run marks them unwatched again when it finishes.
        </div>
      </div>

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
          <div className={styles.formGroup}>
            <label>Verbose Log</label>
            <input type="checkbox" checked={verbose} onChange={(e) => setVerbose(e.target.checked)} />
          </div>
          <button className={shared.button} onClick={handleStart} disabled={startMutation.isPending}>
            Start
          </button>
        </div>
      )}

      {isRunning && stressTestRun && (
        <div className={styles.activeBanner}>
          <Spinner size="sm" />
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

      {isRunning && stressTestRun?.log && (
        <pre ref={logRef} className={styles.logViewer}>
          {stressTestRun.log}
        </pre>
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
              <StatusBadge status={selectedRun.status} />
              <span className={styles.badge}>{selectedRun.config.mode}</span>
              {selectedRun.config.mode === "mixed" && (
                <span className={styles.badge}>{selectedRun.config.transcodePct ?? 50}% transcode</span>
              )}
            </div>
          </div>

          <h4 className={styles.sectionTitle}>Steps</h4>
          <div className="table-scroll">
            <table className={styles.table}>
              <thead>
                <tr>
                  <SortableTh sortKey="step" activeKey={stepSortKey} activeDir={stepSortDir} onSort={toggleStepSort}>
                    Step
                  </SortableTh>
                  <SortableTh
                    sortKey="sessions"
                    activeKey={stepSortKey}
                    activeDir={stepSortDir}
                    onSort={toggleStepSort}
                  >
                    Sessions
                  </SortableTh>
                  <SortableTh
                    sortKey="avgTranscodeSpeed"
                    activeKey={stepSortKey}
                    activeDir={stepSortDir}
                    onSort={toggleStepSort}
                  >
                    Transcode Speed
                  </SortableTh>
                  <SortableTh
                    sortKey="avgBandwidth"
                    activeKey={stepSortKey}
                    activeDir={stepSortDir}
                    onSort={toggleStepSort}
                  >
                    Bandwidth
                  </SortableTh>
                  <SortableTh sortKey="errors" activeKey={stepSortKey} activeDir={stepSortDir} onSort={toggleStepSort}>
                    Errors
                  </SortableTh>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {sortedSteps.map((step) => {
                  // "The run gave up here" is a property of the final step, not
                  // of whichever row happens to render last — so it keys off the
                  // step number rather than the position in the sorted array.
                  const isLast = step.step === lastStepNumber;
                  const isFailed = isLast && !!step.reason;
                  return (
                    <tr key={step.step} className={isFailed ? styles.stepFailed : ""}>
                      <td data-cell="title">{step.step}</td>
                      <td data-cell="meta">
                        {step.sessions}
                        {step.sessionsSeen != null && step.sessionsSeen !== step.sessions
                          ? ` (${step.sessionsSeen} seen)`
                          : ""}
                      </td>
                      <td data-cell="meta">
                        <SpeedCell speed={step.avgTranscodeSpeed} />
                      </td>
                      <td data-cell="meta">{step.avgBandwidth > 0 ? `${step.avgBandwidth} kbps` : EMPTY}</td>
                      <td data-cell="meta">{step.errors + (step.streamErrors ?? 0)}</td>
                      <td data-cell="meta" className={styles.reason}>
                        {step.reason || EMPTY}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* The log is where a failed run explains itself, so it has to be
              reachable after the fact — not only while the run is live. */}
          {selectedRun.log && !isRunning && (
            <>
              <h4 className={styles.sectionTitle}>Log</h4>
              <pre className={`${styles.logViewer} ${styles.detailLog}`}>{selectedRun.log}</pre>
            </>
          )}
        </div>
      )}

      <div className={styles.runsSection}>
        <h4 className={styles.sectionTitle}>Past Runs</h4>
        {runs.length === 0 ? (
          <div className={styles.emptyState}>No stress test runs yet. Click "Run Test" to start one.</div>
        ) : (
          <div className="table-scroll">
            <table className={styles.table}>
              <thead>
                <tr>
                  <SortableTh sortKey="startedAt" activeKey={runSortKey} activeDir={runSortDir} onSort={toggleRunSort}>
                    Date
                  </SortableTh>
                  <SortableTh sortKey="status" activeKey={runSortKey} activeDir={runSortDir} onSort={toggleRunSort}>
                    Status
                  </SortableTh>
                  <SortableTh sortKey="mode" activeKey={runSortKey} activeDir={runSortDir} onSort={toggleRunSort}>
                    Mode
                  </SortableTh>
                  <SortableTh
                    sortKey="maxSessions"
                    activeKey={runSortKey}
                    activeDir={runSortDir}
                    onSort={toggleRunSort}
                  >
                    Max Sessions
                  </SortableTh>
                  <SortableTh sortKey="duration" activeKey={runSortKey} activeDir={runSortDir} onSort={toggleRunSort}>
                    Duration
                  </SortableTh>
                </tr>
              </thead>
              <tbody>
                {sortedRuns.map((run) => (
                  <tr
                    key={run.id}
                    className={`${styles.clickableRow} ${selectedRunId === run.id ? styles.selectedRow : ""}`}
                    onClick={() => setSelectedRunId(run.id === selectedRunId ? null : run.id)}
                  >
                    <td data-cell="title">{formatTime(run.startedAt)}</td>
                    <td data-cell="pill">
                      <StatusBadge status={run.status} />
                    </td>
                    <td data-cell="pill">
                      <span className={styles.badge}>{run.config.mode}</span>
                    </td>
                    <td data-cell="meta">{run.maxSessions ?? "?"}</td>
                    <td data-cell="meta" className={styles.duration}>
                      {run.finishedAt ? formatElapsed(run.startedAt, run.finishedAt) : "…"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
