import { useEffect, useReducer, useRef } from "react";
import { trpc } from "#/trpc";
import ErrorState from "#components/ErrorState";
import RelativeTime from "#components/RelativeTime";
import Spinner from "#components/Spinner";
import { useToast } from "#components/Toast";
import { EMPTY, formatBandwidth, formatFileSize, formatMbps } from "#/format";
import SettingsPageHeader from "./SettingsPageHeader";
import styles from "./SettingsBandwidth.module.css";

const JOB_ID = "bandwidth-test";

/**
 * How long to wait between runs.
 *
 * Cloudflare's endpoints are free and keyless, and it defends them: a few full
 * runs in quick succession earns a 429 on every download over ~10 MB, and it
 * takes about a quarter of an hour to lift. Fifteen minutes is that recovery
 * window, and nothing about back-to-back tests is useful anyway — a link's
 * speed doesn't change in ninety seconds — so the button just says when it's
 * worth asking again.
 */
const COOLDOWN_MS = 15 * 60 * 1000;

/**
 * The ceiling, in whole megabytes.
 *
 * `formatFileSize` is right for the bytes a run actually moved — that's a
 * measurement, and its decimal place is real. Here the number is a limit
 * someone is being asked to accept before clicking, and "200.0 MB" implies a
 * precision the figure doesn't have.
 */
function formatCeiling(bytes: number | undefined): string {
  return bytes ? `${Math.round(bytes / 1_000_000)} MB` : "a few hundred MB";
}

function ResultCard({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className={styles.resultCard}>
      <div className={styles.resultLabel}>{label}</div>
      <div className={styles.resultValue}>{value}</div>
      {sub && <div className={styles.resultSub}>{sub}</div>}
    </div>
  );
}

export default function SettingsBandwidth() {
  const utils = trpc.useUtils();
  const { addToast } = useToast();

  const latestQuery = trpc.bandwidth.latest.useQuery();
  const historyQuery = trpc.bandwidth.history.useQuery({ days: 90 });
  const maxTransferQuery = trpc.bandwidth.maxTransferBytes.useQuery();
  // Only to warn before starting — the test competes with playback for the
  // link it's measuring, which skews the result and the stream both.
  const sessionsQuery = trpc.stats.sessions.useQuery(undefined, { refetchOnWindowFocus: false });

  const activeRun = trpc.bandwidth.activeRun.useQuery(undefined, {
    // Poll fast enough to feel live while a ~40s run is in flight, slowly the
    // rest of the time — this page is otherwise static.
    refetchInterval: (query) => (query.state.data ? 1000 : 10_000),
  });
  const run = activeRun.data;

  const startMutation = trpc.jobs.start.useMutation({
    onSuccess: () => utils.bandwidth.activeRun.invalidate(),
    onError: (err) => addToast(err.message, "error"),
  });
  const cancelMutation = trpc.jobs.cancel.useMutation({
    onError: (err) => addToast(err.message, "error"),
  });

  // The result only exists once the run is gone, so the refresh hangs off the
  // transition rather than off the mutation settling.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !run) {
      utils.bandwidth.latest.invalidate();
      utils.bandwidth.history.invalidate();
    }
    wasRunning.current = !!run;
  }, [run, utils]);

  const latest = latestQuery.data;
  const history = historyQuery.data ?? [];
  const activeStreams = sessionsQuery.data?.length ?? 0;
  // The newest attempt, successful or not — a run that tripped the throttle
  // counts double towards waiting.
  const lastAttemptAt = history.at(-1)?.startedAt ?? 0;
  const cooldownLeftMs = Math.max(0, lastAttemptAt + COOLDOWN_MS - Date.now());

  // Nothing else re-renders this page while it sits idle, so the countdown —
  // and the button it disables — would otherwise stay frozen at whatever the
  // last render computed.
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (cooldownLeftMs <= 0) return;
    const timer = setTimeout(tick, Math.min(cooldownLeftMs, 30_000));
    return () => clearTimeout(timer);
  }, [cooldownLeftMs]);
  const peak = Math.max(1, ...history.map((h) => h.upMbps ?? 0), ...history.map((h) => h.downMbps ?? 0));

  return (
    <div>
      <SettingsPageHeader title="Bandwidth Test" />

      <p className={styles.intro}>
        Measures this server's internet connection against Cloudflare's speed endpoints. The upload figure is what
        remote streams actually consume, so it's the capacity the Stats bandwidth tile divides live playback by. A run
        takes under a minute and moves up to {formatCeiling(maxTransferQuery.data)} of data — worth knowing if this
        connection is metered.
      </p>

      <div className={styles.header}>
        <button
          className={styles.runBtn}
          disabled={!!run || startMutation.isPending || cooldownLeftMs > 0}
          title={cooldownLeftMs > 0 ? "Cloudflare throttles frequent tests" : undefined}
          onClick={() => startMutation.mutate({ jobId: JOB_ID })}
        >
          {run ? "Running…" : "Run test"}
        </button>
        {!run && cooldownLeftMs > 0 && (
          <span className={styles.warning}>
            Another test can be run in {Math.ceil(cooldownLeftMs / 60_000)} min — Cloudflare throttles servers that test
            back to back, and it takes about that long to lift.
          </span>
        )}
        {!run && cooldownLeftMs === 0 && activeStreams > 0 && (
          <span className={styles.warning}>
            {activeStreams} {activeStreams === 1 ? "stream is" : "streams are"} playing — the test will compete with
            playback, and both will look worse than they are.
          </span>
        )}
      </div>

      {run && (
        <div className={styles.activeBanner}>
          <Spinner size="sm" />
          <span className={styles.bannerText}>{run.status === "cancelling" ? "Cancelling…" : "Testing"}</span>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${Math.round(run.progress * 100)}%` }} />
          </div>
          <span className={styles.bannerMessage}>{run.message}</span>
          <button
            className={styles.cancelBtn}
            disabled={run.status === "cancelling" || cancelMutation.isPending}
            onClick={() => cancelMutation.mutate({ runId: run.id })}
          >
            Cancel
          </button>
        </div>
      )}

      {latestQuery.error && (
        <ErrorState
          inline
          title="Couldn't load the last bandwidth test"
          error={latestQuery.error}
          onRetry={() => latestQuery.refetch()}
        />
      )}

      {latest ? (
        <>
          <div className={styles.resultGrid}>
            <ResultCard
              label="Upload"
              value={formatMbps(latest.upMbps)}
              sub={latest.upMbps != null ? "what remote streams use" : null}
            />
            <ResultCard label="Download" value={formatMbps(latest.downMbps)} />
            <ResultCard
              label="Latency"
              value={latest.latencyMs != null ? `${Math.round(latest.latencyMs)} ms` : EMPTY}
              sub={latest.jitterMs != null ? `± ${Math.round(latest.jitterMs)} ms jitter` : null}
            />
            <ResultCard label="Edge" value={latest.pop ?? EMPTY} sub="Cloudflare PoP" />
          </div>
          <p className={styles.caveat}>
            Measured <RelativeTime timestamp={latest.startedAt} />, moving{" "}
            {formatFileSize(latest.bytesDown + latest.bytesUp)}.
            {latest.concurrentKbps > 0 &&
              ` ${formatBandwidth(latest.concurrentKbps)} of playback was in flight at the time, so this reads low.`}
          </p>
        </>
      ) : (
        !latestQuery.isLoading && <div className={styles.empty}>No bandwidth test has been run yet.</div>
      )}

      <h4 className={styles.sectionTitle}>Last 90 days</h4>
      {history.length === 0 ? (
        <div className={styles.empty}>Results will appear here once you've run a test.</div>
      ) : (
        <>
          <div className={styles.chart}>
            {history.map((h) => {
              const value = h.upMbps ?? 0;
              const failed = h.status !== "ok";
              const title = failed
                ? `${new Date(h.startedAt).toLocaleString()} — ${h.status}${h.error ? `: ${h.error}` : ""}`
                : `${new Date(h.startedAt).toLocaleString()} — ↑ ${formatMbps(h.upMbps)} ↓ ${formatMbps(h.downMbps)}`;
              return (
                <div
                  key={h.id}
                  className={`${styles.bar} ${failed ? styles.barFailed : ""}`}
                  style={{ height: failed ? "100%" : `${Math.max(2, (value / peak) * 100)}%` }}
                  title={title}
                />
              );
            })}
          </div>
          <div className={styles.chartAxis}>
            <span>Upload, peak {formatMbps(peak)}</span>
            <span>{history.length} run(s)</span>
          </div>
        </>
      )}
    </div>
  );
}
