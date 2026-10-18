import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./List.module.css";

export type SwipeAction = {
  label: string;
  onAction: () => void;
  tone?: "accent" | "danger" | "neutral";
};

const ACTION_W = 80;

/**
 * A row you can swipe sideways to reveal actions, as Mail and Messages do.
 *
 * Swipe left for the trailing actions, right for the leading one. Swiping
 * most of the way across commits the outermost action outright. Vertical
 * scrolling wins any ambiguous gesture: the row only takes over once the
 * finger has moved clearly sideways. Touch-only — with a mouse the row is just the row, and
 * the same actions must exist elsewhere (a row menu).
 */
export default function SwipeRow({
  children,
  leading,
  trailing = [],
  className,
}: {
  children: ReactNode;
  leading?: SwipeAction;
  trailing?: SwipeAction[];
  className?: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const leadingRef = useRef(leading);
  const trailingRef = useRef(trailing);
  leadingRef.current = leading;
  trailingRef.current = trailing;

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let base = 0;
    let mode: "undecided" | "swipe" | "scroll" = "undecided";
    let current = 0;
    let armed = false;

    const onStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      base = current;
      mode = "undecided";
      armed = false;
    };
    const onMove = (e: TouchEvent) => {
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (mode === "undecided") {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        mode = Math.abs(dx) > Math.abs(dy) * 1.2 ? "swipe" : "scroll";
        if (mode === "swipe") setDragging(true);
      }
      if (mode !== "swipe") return;
      e.preventDefault();
      const max = leadingRef.current ? el.offsetWidth : 0;
      const min = trailingRef.current.length ? -el.offsetWidth : 0;
      current = Math.max(min, Math.min(max, base + dx));
      armed = Math.abs(current) > el.offsetWidth * 0.55;
      setOffset(current);
    };
    const onEnd = () => {
      if (mode !== "swipe") return;
      setDragging(false);
      const width = el.offsetWidth;
      if (armed) {
        const action = current > 0 ? leadingRef.current : trailingRef.current[trailingRef.current.length - 1];
        current = 0;
        setOffset(0);
        action?.onAction();
        return;
      }
      // Settle open (showing the buttons) or closed.
      const open = current < 0 ? -ACTION_W * trailingRef.current.length : ACTION_W;
      current = Math.abs(current) > Math.abs(open) / 2 && Math.abs(current) < width ? open : 0;
      setOffset(current);
    };
    // Any tap elsewhere closes an open row.
    const onDocTouch = (e: TouchEvent) => {
      if (current !== 0 && !el.contains(e.target as Node)) {
        current = 0;
        setOffset(0);
      }
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    document.addEventListener("touchstart", onDocTouch, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      document.removeEventListener("touchstart", onDocTouch);
    };
  }, []);

  const run = (action: SwipeAction) => {
    setOffset(0);
    action.onAction();
  };

  return (
    <div ref={rowRef} className={`${styles.swipe} ${className ?? ""}`}>
      {leading && offset > 0 && (
        <div className={`${styles.swipeActions} ${styles.swipeLeading}`}>
          <button
            type="button"
            className={`${styles.swipeAction} ${styles[`swipe_${leading.tone ?? "accent"}`]}`}
            style={{ width: Math.max(ACTION_W, offset) }}
            onClick={() => run(leading)}
          >
            {leading.label}
          </button>
        </div>
      )}
      {trailing.length > 0 && offset < 0 && (
        <div className={`${styles.swipeActions} ${styles.swipeTrailing}`}>
          {trailing.map((action, i) => (
            <button
              key={action.label}
              type="button"
              className={`${styles.swipeAction} ${styles[`swipe_${action.tone ?? "neutral"}`]}`}
              // The outermost action grows to fill a long swipe.
              style={{ width: i === trailing.length - 1 ? Math.max(ACTION_W, -offset - ACTION_W * i) : ACTION_W }}
              onClick={() => run(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
      <div
        className={`${styles.swipeContent} ${dragging ? "" : styles.swipeSettling}`}
        style={offset ? { transform: `translateX(${offset}px)` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
