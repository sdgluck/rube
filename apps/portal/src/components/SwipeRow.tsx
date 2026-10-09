import { useEffect, useRef, useState, type ReactNode } from "react";
import { haptic } from "@tinkerbell/native-client";

/**
 * A row you swipe left to reveal one action, and swipe most of the way across
 * to commit it — as Mail does. Vertical scrolling wins an ambiguous gesture.
 * Touch-only: the same action must also be a visible button on the row.
 */
export default function SwipeRow({
  children,
  action,
  tone = "accent",
  disabled,
}: {
  children: ReactNode;
  action?: { label: string; onAction: () => void };
  tone?: "accent" | "danger";
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const actionRef = useRef(action);
  actionRef.current = action;

  // Keyed on whether there is an action, not on the object: a new object each
  // render would re-attach the listeners mid-drag and lose the gesture.
  const hasAction = !!action;
  useEffect(() => {
    const el = ref.current;
    if (!el || disabled || !hasAction) return;
    let startX = 0;
    let startY = 0;
    let mode: "undecided" | "swipe" | "scroll" = "undecided";
    let current = 0;
    let base = 0;
    let armed = false;
    const onStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      mode = "undecided";
      base = current;
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
      current = Math.min(0, Math.max(-el.offsetWidth, base + dx));
      const commit = -current > el.offsetWidth * 0.55;
      if (commit !== armed) {
        armed = commit;
        if (commit) haptic("medium");
      }
      setOffset(current);
    };
    const onEnd = () => {
      if (mode !== "swipe") return;
      setDragging(false);
      if (armed) {
        current = 0;
        setOffset(0);
        actionRef.current?.onAction();
        return;
      }
      current = -current > 48 ? -96 : 0;
      setOffset(current);
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
  }, [disabled, hasAction]);

  return (
    <div ref={ref} className="swipe-row">
      {action && offset < 0 && (
        <button
          type="button"
          className={`swipe-action ${tone}`}
          style={{ width: Math.max(96, -offset) }}
          onClick={() => {
            setOffset(0);
            action.onAction();
          }}
        >
          {action.label}
        </button>
      )}
      <div
        className={`swipe-content ${dragging ? "" : "settling"}`}
        style={offset ? { transform: `translateX(${offset}px)` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
