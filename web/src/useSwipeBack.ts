import { useRef, useEffect, useCallback } from "react";
import type { NavigateFunction } from "react-router-dom";

const EDGE_THRESHOLD = 30;
const SWIPE_THRESHOLD = 80;
const MAX_ANGLE = 30;

export default function useSwipeBack(navigate: NavigateFunction) {
  const ref = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const tracking = useRef(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    if (touch.clientX > EDGE_THRESHOLD) return;
    startX.current = touch.clientX;
    startY.current = touch.clientY;
    tracking.current = true;
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!tracking.current || !ref.current) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - startX.current;
    const deltaY = Math.abs(touch.clientY - startY.current);

    // Check angle — if too vertical, cancel
    if (deltaY > 0) {
      const angle = Math.atan2(deltaY, Math.abs(deltaX)) * (180 / Math.PI);
      if (angle > MAX_ANGLE) {
        tracking.current = false;
        ref.current.style.transform = "";
        ref.current.style.transition = "";
        return;
      }
    }

    if (deltaX > 0) {
      ref.current.style.transform = `translateX(${deltaX}px)`;
      ref.current.style.transition = "none";
    }
  }, []);

  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (!tracking.current || !ref.current) return;
      tracking.current = false;

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - startX.current;

      if (deltaX >= SWIPE_THRESHOLD) {
        ref.current.style.transition = "transform 200ms ease-out";
        ref.current.style.transform = "translateX(100%)";
        setTimeout(() => navigate(-1), 200);
      } else {
        ref.current.style.transition = "transform 200ms ease-out";
        ref.current.style.transform = "";
      }
    },
    [navigate],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: true });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return ref;
}
