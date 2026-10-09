import { useEffect, type RefObject } from "react";
import { haptic } from "@tinkerbell/native-client";

/**
 * Drag a bottom sheet down to dismiss it, the way every native sheet works.
 *
 * The drag starts from the grabber or header, or from the body once it is
 * scrolled to the top — so pulling down on a long list scrolls the list first
 * and only then moves the sheet, which is the behaviour people's thumbs
 * already expect. Released past a quarter of its height, or flicked, it
 * dismisses; otherwise it springs back.
 *
 * Touch events rather than pointer events: the move has to be able to
 * `preventDefault` the body's own scroll once the sheet has taken the gesture,
 * and only a non-passive touchmove can.
 *
 * `canDismiss: false` (a destructive flow that opted out of backdrop dismiss)
 * still lets the sheet follow the finger a little and spring back, so it feels
 * like a sheet rather than a wall — it just never lets go.
 */
export function useSheetDrag(
  panelRef: RefObject<HTMLElement | null>,
  opts: { enabled: boolean; canDismiss: boolean; onDismiss: () => void; scrollSelector?: string },
): void {
  const { enabled, canDismiss, onDismiss, scrollSelector } = opts;

  useEffect(() => {
    const panel = panelRef.current;
    if (!enabled || !panel) return;

    let startY = 0;
    let startT = 0;
    let dy = 0;
    let dragging = false;
    let eligible = false;

    const scrolledToTop = (target: EventTarget | null) => {
      const scroller = scrollSelector ? (target as Element | null)?.closest?.(scrollSelector) : null;
      return !scroller || scroller.scrollTop <= 0;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      // Controls keep their own gestures: a slider or a text field must not
      // turn into a sheet drag.
      if ((e.target as Element).closest("input, textarea, select, [data-no-sheet-drag]")) return;
      startY = e.touches[0].clientY;
      startT = performance.now();
      dy = 0;
      dragging = false;
      eligible = scrolledToTop(e.target);
    };

    const onMove = (e: TouchEvent) => {
      if (!eligible) return;
      const y = e.touches[0].clientY - startY;
      if (!dragging) {
        if (y <= 4) {
          // Moving up, or not yet moving: the body scrolls as normal.
          if (y < -4) eligible = false;
          return;
        }
        dragging = true;
        panel.style.transition = "none";
      }
      e.preventDefault();
      // Past the dismiss point a locked sheet resists, like a rubber band.
      dy = canDismiss ? y : Math.sqrt(y) * 6;
      panel.style.transform = `translateY(${dy}px)`;
    };

    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      const velocity = dy / Math.max(1, performance.now() - startT);
      const past = dy > panel.offsetHeight * 0.25 || velocity > 0.6;
      panel.style.transition = "transform 280ms cubic-bezier(0.32, 0.72, 0, 1)";
      if (canDismiss && past) {
        panel.style.transform = "translateY(100%)";
        haptic("light");
        window.setTimeout(onDismiss, 200);
      } else {
        panel.style.transform = "";
      }
    };

    panel.addEventListener("touchstart", onStart, { passive: true });
    panel.addEventListener("touchmove", onMove, { passive: false });
    panel.addEventListener("touchend", onEnd);
    panel.addEventListener("touchcancel", onEnd);
    return () => {
      panel.removeEventListener("touchstart", onStart);
      panel.removeEventListener("touchmove", onMove);
      panel.removeEventListener("touchend", onEnd);
      panel.removeEventListener("touchcancel", onEnd);
      panel.style.transform = "";
      panel.style.transition = "";
    };
  }, [panelRef, enabled, canDismiss, onDismiss, scrollSelector]);
}
