import { trpc } from "../trpc";
import styles from "./SettingsHealth.module.css";

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const SPARKLINE_W = 200;
const SPARKLINE_H = 32;
const SPARKLINE_BUCKETS = 48; // 30-min buckets over 24h

function Sparkline({ points }: { points: Array<{ status: string; timestamp: number }> }) {
  if (points.length === 0) return null;

  const now = Date.now();
  const windowMs = 24 * 60 * 60 * 1000;
  const start = now - windowMs;
  const bucketMs = windowMs / SPARKLINE_BUCKETS;

  // Bucket health checks: each bucket gets a ratio of ok / total
  const buckets: Array<{ ok: number; total: number }> = Array.from({ length: SPARKLINE_BUCKETS }, () => ({
    ok: 0,
    total: 0,
  }));

  for (const p of points) {
    const idx = Math.floor((p.timestamp - start) / bucketMs);
    if (idx < 0 || idx >= SPARKLINE_BUCKETS) continue;
    buckets[idx].total++;
    if (p.status === "ok") buckets[idx].ok++;
  }

  const barW = SPARKLINE_W / SPARKLINE_BUCKETS;
  const gap = 1;

  return (
    <svg
      width="100%"
      height={SPARKLINE_H}
      viewBox={`0 0 ${SPARKLINE_W} ${SPARKLINE_H}`}
      preserveAspectRatio="none"
      className={styles.sparkline}
    >
      {buckets.map((b, i) => {
        if (b.total === 0) {
          return (
            <rect key={i} x={i * barW + gap / 2} y={0} width={barW - gap} height={SPARKLINE_H} rx={1} fill="#e9ecef" />
          );
        }
        const ratio = b.ok / b.total;
        const color = ratio === 1 ? "#28a745" : ratio === 0 ? "#dc3545" : "#fd7e14";
        return (
          <rect
            key={i}
            x={i * barW + gap / 2}
            y={0}
            width={barW - gap}
            height={SPARKLINE_H}
            rx={1}
            fill={color}
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}

export default function SettingsHealth() {
  const utils = trpc.useUtils();
  const query = trpc.health.status.useQuery(undefined, {
    refetchInterval: 10000,
    refetchOnWindowFocus: false,
  });
  const historyQuery = trpc.health.history.useQuery(
    { hours: 24 },
    { refetchInterval: 30000, refetchOnWindowFocus: false },
  );

  const checkMutation = trpc.health.check.useMutation({
    onSettled: () => {
      utils.health.status.invalidate();
      utils.health.history.invalidate();
    },
  });

  return (
    <div>
      <div className={styles.header}>
        <span className={styles.headerHint}>Last 24 hours</span>
        <button
          className={styles.refreshBtn}
          onClick={() => {
            utils.health.status.invalidate();
            utils.health.history.invalidate();
          }}
        >
          Refresh
        </button>
      </div>

      <div className={styles.serviceList}>
        {query.data?.map((svc) => {
          let dotClass = styles.statusNone;
          let message = "No activity recorded";

          if (!svc.configured) {
            message = "Not configured";
          } else if (svc.status === "ok") {
            dotClass = styles.statusOk;
            message = svc.message || "OK";
          } else if (svc.status === "error") {
            dotClass = styles.statusError;
            message = svc.message || "Error";
          }

          const isChecking = checkMutation.isPending && checkMutation.variables?.service === svc.service;
          const history = historyQuery.data?.[svc.service] ?? [];
          const uptimeStr =
            history.length > 0
              ? `${((history.filter((p) => p.status === "ok").length / history.length) * 100).toFixed(1)}% uptime`
              : null;

          return (
            <div key={svc.service} className={styles.serviceCard}>
              <div className={`${styles.statusDot} ${dotClass}`} />
              <div className={styles.serviceInfo}>
                <div className={styles.serviceNameRow}>
                  <span className={styles.serviceName}>{svc.service}</span>
                  {uptimeStr && <span className={styles.serviceUptime}>{uptimeStr}</span>}
                  {svc.timestamp && <span className={styles.serviceTime}>{timeAgo(svc.timestamp)}</span>}
                </div>
                <div className={styles.serviceMessage}>{message}</div>
                {svc.configured && <Sparkline points={history} />}
              </div>
              {svc.configured && (
                <button
                  className={styles.checkBtn}
                  disabled={isChecking}
                  onClick={() => checkMutation.mutate({ service: svc.service })}
                >
                  {isChecking ? "Checking..." : "Check"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
