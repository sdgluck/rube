import { useEffect, useMemo, useRef, useState } from "react";
import { parseLogLine } from "@tinkerbell/contracts";
import styles from "./RunLog.module.css";
import { saveFile } from "@tinkerbell/native-client";

/**
 * Lines worth pulling out when someone only wants to know what went wrong.
 * Deliberately broad: a false positive costs a line of context, a false
 * negative hides the failure the filter was turned on to find.
 */
const ERROR_PATTERN = /error|failed|exception|fatal|panic|ENOENT|ECONNREFUSED/i;

/** Remembered per browser: someone who reads logs with times wants them every time. */
const TIMES_KEY = "tinkerbell.runlog.timestamps";

function readShowTimes(): boolean {
  try {
    return localStorage.getItem(TIMES_KEY) === "1";
  } catch {
    return false;
  }
}

function writeShowTimes(on: boolean): void {
  try {
    localStorage.setItem(TIMES_KEY, on ? "1" : "0");
  } catch {
    // Private mode, blocked storage: the toggle still works for this page.
  }
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

interface RunLogProps {
  /** The whole log so far. Streaming is the caller's problem (`useRunLog`). */
  log: string;
  /**
   * `full` gets the toolbar — filter, errors-only, timestamps, copy, download
   * — and belongs on a page given over to one run. `compact` is a pane with a
   * Copy button in the corner, for a dashboard panel or an expanded table row
   * where the log is one thing among several.
   */
  variant?: "full" | "compact";
  /**
   * The run is still going, so lines are still arriving: offers Follow, which
   * keeps the newest line in view — on the page as well as in the pane, since
   * on a phone it is the page that scrolls.
   */
  live?: boolean;
  /** Filename for the Download button. Omitted means no download offered. */
  downloadName?: string;
  /** Shown in place of output. "(no output yet)" reads better mid-run. */
  emptyText?: string;
  ariaLabel?: string;
  className?: string;
}

/**
 * A run's output: the dark pane, the toolbar over it, and the scroll behaviour.
 *
 * This existed three times over — the job run page, the dashboard's latest-run
 * panel, and the rules page — with the same regex, the same auto-scroll ref
 * dance and three slightly different toolbars. One of the three then borrowed
 * the Jobs stylesheet from another feature's directory to get the look, which
 * is what finally made the case for a component.
 *
 * Each stored line starts with the time it was written (`stampLog` in
 * contracts); runs from before that have none. Times are hidden unless asked
 * for, and filtering never matches them — a filter for "18" shouldn't return
 * every line written at six o'clock.
 */
export default function RunLog({
  log,
  variant = "full",
  live = false,
  downloadName,
  emptyText = "(no output yet)",
  ariaLabel = "Run log",
  className,
}: RunLogProps) {
  const [filter, setFilter] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [showTimes, setShowTimes] = useState(readShowTimes);
  const [follow, setFollow] = useState(true);
  const logRef = useRef<HTMLPreElement>(null);
  const endRef = useRef<HTMLSpanElement>(null);
  /**
   * For a finished run: open at the tail, and stay there while the reader is
   * there, but let go the moment they scroll up. A live run uses `follow`,
   * which is the same idea made visible and able to move the page too.
   */
  const autoScroll = useRef(true);

  const isFiltering = !!(filter || errorsOnly);
  const lines = useMemo(() => (log ? log.split("\n").map(parseLogLine) : []), [log]);
  const hasTimes = useMemo(() => lines.some((l) => l.at !== undefined), [lines]);
  const timesOn = variant === "full" && showTimes && hasTimes;

  const shown = useMemo(() => {
    if (!isFiltering) return lines;
    const needle = filter.toLowerCase();
    return lines.filter((line) => {
      if (errorsOnly && !ERROR_PATTERN.test(line.text)) return false;
      if (needle && !line.text.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [lines, filter, errorsOnly, isFiltering]);

  /** The log as text, as it reads with the current toggles — what Copy and Download hand over. */
  const asText = (from: typeof lines) =>
    from.map((l) => (timesOn && l.at !== undefined ? `${timeFormat.format(l.at)} ${l.text}` : l.text)).join("\n");

  const following = live && follow && !isFiltering && variant === "full";

  useEffect(() => {
    // Filtering rewrites the pane from the top; jumping to the bottom of a
    // three-line result reads as a glitch.
    if (isFiltering) return;
    if (following) {
      // Both the pane and the page: `scrollIntoView` scrolls every scrollable
      // ancestor, so this works whether the pane is bounded (desktop) or the
      // document is what scrolls (phone layout).
      endRef.current?.scrollIntoView({ block: "end" });
    } else if (!live && autoScroll.current && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log, isFiltering, following, live]);

  // Scrolling the page up while following means "let me read": stop. The
  // check is where the end of the log is, not which way the wheel went, so the
  // follow scroll itself — which leaves the end in view — never trips it.
  useEffect(() => {
    if (!following) return;
    const onScroll = () => {
      const end = endRef.current?.getBoundingClientRect();
      if (end && end.bottom > window.innerHeight + 80) setFollow(false);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [following]);

  const handleScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    autoScroll.current = atBottom;
    if (following && !atBottom) setFollow(false);
  };

  const toggleFollow = (on: boolean) => {
    setFollow(on);
    // Back to the end straight away, not on the next line — there may not be one for a while.
    if (on) endRef.current?.scrollIntoView({ block: "end" });
  };

  const toggleTimes = (on: boolean) => {
    setShowTimes(on);
    writeShowTimes(on);
  };

  const handleDownload = () => {
    if (!log || !downloadName) return;
    // A download in the browser, the share sheet in the app.
    void saveFile(new Blob([asText(lines)], { type: "text/plain" }), downloadName);
  };

  const body =
    shown.length === 0 || (shown.length === 1 && shown[0]!.text === "")
      ? isFiltering
        ? "(no matching lines)"
        : emptyText
      : timesOn
        ? shown.map((line, i) => (
            <span key={i}>
              {line.at !== undefined && (
                <span className={styles.time} title={new Date(line.at).toLocaleString()}>
                  {timeFormat.format(line.at)}{" "}
                </span>
              )}
              {line.text}
              {"\n"}
            </span>
          ))
        : shown.map((l) => l.text).join("\n");

  const pane = (
    <pre
      ref={logRef}
      className={variant === "compact" ? styles.viewerCompact : styles.viewer}
      onScroll={handleScroll}
      tabIndex={0}
      role="log"
      aria-label={ariaLabel}
    >
      {body}
      <span ref={endRef} />
    </pre>
  );

  if (variant === "compact") {
    return (
      <div className={`${styles.wrapper} ${className ?? ""}`}>
        {log && (
          <button type="button" className={styles.copyBtn} onClick={() => navigator.clipboard.writeText(asText(lines))}>
            Copy
          </button>
        )}
        {pane}
      </div>
    );
  }

  return (
    <div className={`${styles.full} ${className ?? ""}`}>
      <div className={styles.toolbar}>
        <input
          type="text"
          className={styles.filterInput}
          placeholder="Filter log…"
          aria-label="Filter log"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className={styles.errorToggle}>
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
          Errors only
        </label>
        <label className={styles.errorToggle} title={hasTimes ? undefined : "This run's log has no times"}>
          <input
            type="checkbox"
            checked={timesOn}
            disabled={!hasTimes}
            onChange={(e) => toggleTimes(e.target.checked)}
          />
          Timestamps
        </label>
        {live && !isFiltering && (
          <label className={styles.errorToggle}>
            <input type="checkbox" checked={follow} onChange={(e) => toggleFollow(e.target.checked)} />
            Follow
          </label>
        )}
        {log && (
          <>
            <button
              type="button"
              className={styles.toolbarBtn}
              onClick={() => navigator.clipboard.writeText(asText(lines))}
            >
              Copy
            </button>
            {downloadName && (
              <button type="button" className={styles.toolbarBtn} onClick={handleDownload}>
                Download
              </button>
            )}
          </>
        )}
      </div>
      <div className={styles.wrapper}>{pane}</div>
    </div>
  );
}
