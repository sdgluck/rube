import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./RunLog.module.css";
import { saveFile } from "@tinkerbell/native-client";

/**
 * Lines worth pulling out when someone only wants to know what went wrong.
 * Deliberately broad: a false positive costs a line of context, a false
 * negative hides the failure the filter was turned on to find.
 */
const ERROR_PATTERN = /error|failed|exception|fatal|panic|ENOENT|ECONNREFUSED/i;

interface RunLogProps {
  /** The whole log so far. Streaming is the caller's problem (`useRunLog`). */
  log: string;
  /**
   * `full` gets the toolbar — filter, errors-only, copy, download — and belongs
   * on a page given over to one run. `compact` is a pane with a Copy button in
   * the corner, for a dashboard panel or an expanded table row where the log is
   * one thing among several.
   */
  variant?: "full" | "compact";
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
 */
export default function RunLog({
  log,
  variant = "full",
  downloadName,
  emptyText = "(no output yet)",
  ariaLabel = "Run log",
  className,
}: RunLogProps) {
  const [filter, setFilter] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  /**
   * Follow the tail as lines arrive, but stop the moment the reader scrolls up.
   * Otherwise every poll yanks them back to the bottom and reading anything
   * that already scrolled past is impossible. Re-arms when they return to the
   * bottom themselves.
   */
  const autoScroll = useRef(true);

  const isFiltering = !!(filter || errorsOnly);

  const filtered = useMemo(() => {
    if (!log || !isFiltering) return log;
    return log
      .split("\n")
      .filter((line) => {
        if (errorsOnly && !ERROR_PATTERN.test(line)) return false;
        if (filter && !line.toLowerCase().includes(filter.toLowerCase())) return false;
        return true;
      })
      .join("\n");
  }, [log, filter, errorsOnly, isFiltering]);

  useEffect(() => {
    // Filtering rewrites the pane from the top; jumping to the bottom of a
    // three-line result reads as a glitch.
    if (autoScroll.current && logRef.current && !isFiltering) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log, isFiltering]);

  const handleScroll = () => {
    const el = logRef.current;
    if (!el) return;
    autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  };

  const handleDownload = () => {
    if (!log || !downloadName) return;
    // A download in the browser, the share sheet in the app.
    void saveFile(new Blob([log], { type: "text/plain" }), downloadName);
  };

  const pane = (
    <pre
      ref={logRef}
      className={variant === "compact" ? styles.viewerCompact : styles.viewer}
      onScroll={handleScroll}
      tabIndex={0}
      role="log"
      aria-label={ariaLabel}
    >
      {filtered || (isFiltering ? "(no matching lines)" : emptyText)}
    </pre>
  );

  if (variant === "compact") {
    return (
      <div className={`${styles.wrapper} ${className ?? ""}`}>
        {log && (
          <button type="button" className={styles.copyBtn} onClick={() => navigator.clipboard.writeText(log)}>
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
        {log && (
          <>
            <button type="button" className={styles.toolbarBtn} onClick={() => navigator.clipboard.writeText(log)}>
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
