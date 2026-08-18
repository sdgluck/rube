import { useState } from "react";
import { SkeletonBlock } from "#components/Skeleton";
import ErrorState from "#components/ErrorState";
import { trpc } from "#/trpc";
import styles from "#pages/Stats/Stats.module.css";
import { formatNumber } from "#/format";
import { PanelShell, type DashboardPanelProps } from "#components/dashboard";
import { BarChart } from "./BarChart";
import { PeriodSelector } from "./PeriodSelector";
import { usePeriod } from "./usePeriod";

/**
 * Two readings of the same history, because they answer different questions.
 *
 * "By day" is the trend — is the server busier than it was, and was the weekend
 * a spike or a Tuesday. "By hour" is the shape of a typical day, which is what
 * you want before scheduling a nightly job or judging whether a transcode spike
 * has anyone actually watching.
 */
const VIEWS = [
  { id: "day" as const, label: "By day" },
  { id: "hour" as const, label: "By hour" },
];
type View = (typeof VIEWS)[number]["id"];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** `Tue 12 Aug` for a bar `daysAgo` days back from today. */
function dayLabel(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${date.toLocaleString(undefined, { month: "short" })}`;
}

function hourLabel(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

export function PlaybackActivityPanel({ dragHandle, dragProps }: DashboardPanelProps) {
  // No all-time option: a day-by-day chart is a window by construction, and the
  // hourly view reads better over a bounded stretch than over a server's whole
  // life, where one busy fortnight three years ago flattens everything since.
  const { periodDays, setPeriodDays } = usePeriod(30);
  const [view, setView] = useState<View>("day");

  const seriesQuery = trpc.stats.activitySeries.useQuery({ days: periodDays || 30 }, { enabled: view === "day" });
  const hoursQuery = trpc.stats.playsByHour.useQuery({ periodDays }, { enabled: view === "hour" });

  const query = view === "day" ? seriesQuery : hoursQuery;
  const values = (view === "day" ? seriesQuery.data : hoursQuery.data) ?? [];
  const total = values.reduce((sum, n) => sum + n, 0);
  const busiest = values.length > 0 ? values.indexOf(Math.max(...values)) : -1;
  const currentHour = new Date().getHours();

  return (
    <PanelShell
      title="Playback Activity"
      meta={total > 0 ? `${formatNumber(total)} plays` : undefined}
      actions={
        <>
          <div className={styles.segmented} role="tablist" aria-label="Chart">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={view === v.id}
                className={`${styles.segmentedBtn} ${view === v.id ? styles.segmentedBtnActive : ""}`}
                onClick={() => setView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <PeriodSelector value={periodDays} onChange={setPeriodDays} omitAll />
        </>
      }
      dragHandle={dragHandle}
      dragProps={dragProps}
    >
      {query.isLoading && <SkeletonBlock width="100%" height={104} />}
      {query.error && <ErrorState inline title="Couldn't load playback activity" onRetry={() => query.refetch()} />}
      {query.data && total === 0 && (
        <div className={styles.muted}>
          No plays recorded in this window. History fills in as things are played, or run Import Plex Watch History from
          Jobs.
        </div>
      )}
      {query.data && total > 0 && view === "day" && (
        <>
          <BarChart
            values={values}
            // The last bar is today. Labelling every day would overprint at 90
            // columns, so only the ends and a few steps between them are named —
            // enough to place a spike without pretending to be an axis.
            labelFor={(i) => {
              const step = Math.ceil(values.length / 6);
              if (i === values.length - 1) return "Today";
              return i % step === 0 ? dayLabel(values.length - 1 - i).slice(4) : null;
            }}
            captionFor={(i, value) =>
              `${i === values.length - 1 ? "Today" : dayLabel(values.length - 1 - i)}: ${value} play${value === 1 ? "" : "s"}`
            }
            highlight={(i) => i === values.length - 1}
          />
          <div className={styles.factRow}>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Busiest day</span>
              <span className={styles.factValue}>
                {busiest >= 0 ? `${dayLabel(values.length - 1 - busiest)} — ${values[busiest]}` : "—"}
              </span>
            </span>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Daily average</span>
              <span className={styles.factValue}>{(total / values.length).toFixed(1)}</span>
            </span>
          </div>
        </>
      )}
      {query.data && total > 0 && view === "hour" && (
        <>
          <BarChart
            values={values}
            labelFor={(i) => (i % 6 === 0 ? hourLabel(i) : null)}
            captionFor={(i, value) =>
              `${hourLabel(i)}–${hourLabel((i + 1) % 24)}: ${value} play${value === 1 ? "" : "s"}`
            }
            highlight={(i) => i === currentHour}
          />
          <div className={styles.factRow}>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Peak hour</span>
              <span className={styles.factValue}>
                {busiest >= 0 ? `${hourLabel(busiest)} — ${values[busiest]} plays` : "—"}
              </span>
            </span>
            <span className={styles.fact}>
              <span className={styles.factLabel}>Quietest stretch</span>
              {/* The longest run of hours with nothing playing — the window a
                  heavy job can have without competing with anyone. */}
              <span className={styles.factValue}>{quietStretch(values)}</span>
            </span>
          </div>
        </>
      )}
    </PanelShell>
  );
}

/**
 * The longest unbroken run of zero-play hours, as a wall-clock window.
 *
 * Wraps around midnight, which is the whole point: the quiet stretch on a
 * domestic server is almost always 01:00–08:00, and a scan that stopped at the
 * end of the array would report it as two short ones.
 */
function quietStretch(hours: number[]): string {
  let best = { start: -1, length: 0 };
  let runStart = -1;
  let run = 0;
  // Two laps, so a run that straddles midnight is seen whole. Capped at 24 so a
  // completely silent day reports a day rather than two.
  for (let i = 0; i < hours.length * 2; i++) {
    if (hours[i % 24] === 0) {
      if (run === 0) runStart = i % 24;
      run++;
      if (run > best.length && run <= 24) best = { start: runStart, length: run };
    } else {
      run = 0;
    }
  }
  if (best.length === 0) return "None — every hour has plays";
  if (best.length >= 24) return "All day";
  return `${hourLabel(best.start)}–${hourLabel((best.start + best.length) % 24)}`;
}
