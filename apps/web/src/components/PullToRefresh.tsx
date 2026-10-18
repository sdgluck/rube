import { useEffect, useRef, useState, type ReactNode } from "react";
import Spinner from "./Spinner";
import styles from "./PullToRefresh.module.css";

interface PullToRefreshProps {
  onRefresh: () => void | Promise<void>;
  children: ReactNode;
}

/** How far the finger must travel, after damping, to trigger a refresh. */
const THRESHOLD = 64;
const MAX = 120;
/** Where the content rests while the refresh runs. */
const HOLD = 52;

/**
 * Pull down at the top of a list to refresh it.
 *
 * iOS: the content follows the finger and reveals an activity spinner above
 * it. Android: a Material disc drops in over the content, which stays put.
 *
 * The listeners are attached by hand because React registers touchmove as
 * passive, and only a non-passive listener can stop the platform's own
 * rubber band from playing at the same time as the pull. The phone layout
 * scrolls the document, so "at the top" is `window.scrollY`.
 */
export default function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const isTouchDevice = typeof window !== "undefined" && "ontouchstart" in window;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !isTouchDevice) return;
    let startY = 0;
    let active = false;
    let distance = 0;
    let armed = false;
    let busy = false;

    const onStart = (e: TouchEvent) => {
      if (busy || window.scrollY > 0 || e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      active = true;
      setDragging(true);
      distance = 0;
      armed = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || window.scrollY > 0) {
        if (distance > 0) setPull(0);
        active = false;
        setDragging(false);
        return;
      }
      e.preventDefault();
      // Resistance grows with distance, as a native pull does.
      distance = Math.min(MAX, dy * 0.45);
      armed = distance >= THRESHOLD;
      setPull(distance);
    };
    const onEnd = async () => {
      if (!active) return;
      active = false;
      setDragging(false);
      if (!armed) {
        setPull(0);
        return;
      }
      busy = true;
      setRefreshing(true);
      setPull(HOLD);
      try {
        await onRefreshRef.current();
      } finally {
        busy = false;
        setRefreshing(false);
        setPull(0);
      }
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [isTouchDevice]);

  if (!isTouchDevice) {
    return <>{children}</>;
  }

  const progress = Math.min(1, pull / THRESHOLD);

  return (
    <div ref={wrapRef} className={styles.wrapper} style={{ "--pull": `${pull}px` } as React.CSSProperties}>
      {(pull > 0 || refreshing) && (
        <div className={styles.indicator} style={{ opacity: refreshing ? 1 : progress }} aria-hidden={!refreshing}>
          {refreshing ? (
            <Spinner size="sm" label="Refreshing" />
          ) : (
            <span className={styles.ring} style={{ "--progress": progress } as React.CSSProperties} />
          )}
        </div>
      )}
      {/* Transformed only while pulled: a transform makes this the containing
          block for any `position: fixed` inside the page (a bulk-action bar). */}
      <div
        className={`${styles.content} ${dragging ? "" : styles.settling}`}
        style={pull > 0 ? { transform: `translateY(${pull}px)` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
