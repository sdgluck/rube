import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PanelShell, type DashboardPanelProps } from "#components/dashboard";
import EmptyState from "#components/EmptyState";
import { formatDuration } from "#/format";
import { trpc } from "#/trpc";
import styles from "./TimelinePanel.module.css";

/**
 * What actually ran last night, and why it ran when it did.
 *
 * The run list answers "what happened". It does not answer "why did the
 * nightly job start at 02:40", which is the question people arrive with — and
 * the answer is usually one of three things the runner does silently: the
 * `default` lane runs one job at a time, a scheduled start can be held back
 * while somebody is streaming, and the watchdog can force-fail a run that
 * wedged. Laid out against a clock, all three are obvious at a glance.
 *
 * Lanes rather than jobs as rows: the lane is what explains the shape. Thirty
 * job rows mostly empty is a chart of the schedule; two lane rows packed end
 * to end is a chart of the machine.
 */

const WINDOW_MS = 24 * 3_600_000;
const LANE_LABELS: Record<string, string> = {
  default: "Default",
  interactive: "Interactive",
  internal: "Internal",
};

/** The order lanes are drawn in, whatever order the runs came back in. */
const LANE_ORDER = ["default", "interactive", "internal"];

function statusClass(status: string): string {
  if (status === "completed") return styles.completed;
  if (status === "failed") return styles.failed;
  if (status === "cancelled") return styles.cancelled;
  return styles.running;
}

export function TimelinePanel({ dragHandle, dragProps }: DashboardPanelProps) {
  const navigate = useNavigate();
  const query = trpc.jobs.timeline.useQuery(
    { windowMs: WINDOW_MS },
    // Slower than the run pollers: this is a shape-of-the-night view, and a bar
    // moving two pixels every second is motion without information.
    { refetchInterval: 30_000, refetchOnWindowFocus: false },
  );

  const data = query.data;

  const lanes = useMemo(() => {
    if (!data) return [];
    const byLane = new Map<string, typeof data.runs>();
    for (const run of data.runs) {
      const arr = byLane.get(run.lane) ?? [];
      arr.push(run);
      byLane.set(run.lane, arr);
    }
    return LANE_ORDER.filter((lane) => byLane.has(lane)).map((lane) => ({ lane, runs: byLane.get(lane)! }));
  }, [data]);

  // Six labels across the window — enough to read a time off, few enough not
  // to collide at phone width.
  const ticks = useMemo(() => {
    if (!data) return [];
    const step = data.windowMs / 6;
    return Array.from({ length: 7 }, (_, i) => {
      const at = data.now - data.windowMs + step * i;
      return {
        pct: (i / 6) * 100,
        label: new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
      };
    });
  }, [data]);

  const position = (startedAt: number, finishedAt: number | null) => {
    if (!data) return { left: 0, width: 0 };
    const from = data.now - data.windowMs;
    const start = Math.max(startedAt, from);
    const end = Math.min(finishedAt ?? data.now, data.now);
    return {
      left: ((start - from) / data.windowMs) * 100,
      width: (Math.max(end - start, 0) / data.windowMs) * 100,
    };
  };

  return (
    <PanelShell
      title="Last 24 hours"
      meta={data ? `${data.runs.length} run${data.runs.length === 1 ? "" : "s"}` : undefined}
      lede="One row per lane. The default lane runs a single job at a time, which is why the nightly batch is a chain rather than a pile-up."
      dragHandle={dragHandle}
      dragProps={dragProps}
    >
      {lanes.length === 0 ? (
        <EmptyState icon="list" title="Nothing ran" description="No job has run in the last 24 hours." />
      ) : (
        <>
          <div className={styles.chart}>
            {lanes.map(({ lane, runs }) => (
              <div key={lane} className={styles.laneRow}>
                <span className={styles.laneName}>{LANE_LABELS[lane] ?? lane}</span>
                <div className={styles.track}>
                  {runs.map((run) => {
                    const { left, width } = position(run.startedAt, run.finishedAt);
                    const duration = formatDuration((run.finishedAt ?? data!.now) - run.startedAt);
                    const why =
                      run.failureKind === "watchdog"
                        ? " — force-failed by the watchdog, which means it may still be running inside a worker thread"
                        : run.failureKind === "cancel-timeout"
                          ? " — cancellation never completed"
                          : "";
                    return (
                      <button
                        key={run.id}
                        type="button"
                        className={`${styles.bar} ${statusClass(run.status)}`}
                        style={{ left: `${left}%`, width: `${Math.max(width, 0.3)}%` }}
                        title={`${run.jobName} · ${new Date(run.startedAt).toLocaleTimeString()} · ${duration} · ${run.status}${why}`}
                        aria-label={`${run.jobName}, ${run.status}, ${duration}`}
                        onClick={() => navigate(`/jobs/runs/${run.id}`)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}

            <div className={styles.axis}>
              <span />
              <div className={styles.ticks}>
                {ticks.map((tick) => (
                  <span key={tick.pct} className={styles.tick} style={{ left: `${tick.pct}%` }}>
                    {tick.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={`${styles.swatch} ${styles.completed}`} aria-hidden /> completed
            </span>
            <span className={styles.legendItem}>
              <span className={`${styles.swatch} ${styles.running}`} aria-hidden /> running
            </span>
            <span className={styles.legendItem}>
              <span className={`${styles.swatch} ${styles.failed}`} aria-hidden /> failed
            </span>
            <span className={styles.legendItem}>
              <span className={`${styles.swatch} ${styles.cancelled}`} aria-hidden /> cancelled
            </span>
          </div>

          {/* Held starts aren't runs — they exist only in the scheduler's
              memory until they either start or hit their ceiling — so they get
              a sentence rather than a bar with a length they don't have. */}
          {data && data.deferred.length > 0 && (
            <p className={styles.heldNote}>
              {data.deferred.length} scheduled start{data.deferred.length === 1 ? " is" : "s are"} being held back while
              the server is busy: {data.deferred.map((d) => d.jobName).join(", ")}.
            </p>
          )}
        </>
      )}
    </PanelShell>
  );
}
