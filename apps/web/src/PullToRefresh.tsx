import { useRef, useState, useCallback, ReactNode } from "react";
import Spinner from "./Spinner";
import styles from "./PullToRefresh.module.css";

interface PullToRefreshProps {
  onRefresh: () => void | Promise<void>;
  children: ReactNode;
}

const THRESHOLD = 60;

export default function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const pulling = useRef(false);

  const isTouchDevice = typeof window !== "undefined" && "ontouchstart" in window;

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (refreshing) return;
      if (window.scrollY > 0) return;
      startY.current = e.touches[0].clientY;
      pulling.current = true;
    },
    [refreshing],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!pulling.current || refreshing) return;
      const deltaY = e.touches[0].clientY - startY.current;
      if (deltaY < 0) {
        pulling.current = false;
        setPullDistance(0);
        return;
      }
      // Dampen the pull
      setPullDistance(Math.min(deltaY * 0.4, 100));
    },
    [refreshing],
  );

  const handleTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;
    if (pullDistance >= THRESHOLD) {
      setRefreshing(true);
      setPullDistance(40);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, onRefresh]);

  if (!isTouchDevice) {
    return <>{children}</>;
  }

  return (
    <div
      className={styles.wrapper}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {(pullDistance > 0 || refreshing) && (
        <div className={styles.indicator} style={{ transform: `translateX(-50%) translateY(${pullDistance}px)` }}>
          {refreshing ? (
            <Spinner size="sm" />
          ) : (
            <svg
              className={`${styles.arrow} ${pullDistance >= THRESHOLD ? styles.arrowReady : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          )}
        </div>
      )}
      <div
        style={
          pullDistance > 0
            ? {
                transform: `translateY(${pullDistance}px)`,
                transition: pulling.current ? "none" : "transform 0.2s ease",
              }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
