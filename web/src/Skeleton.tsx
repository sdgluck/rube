import styles from "./Skeleton.module.css";

export function SkeletonLine({ width = "100%" }: { width?: string | number }) {
  return <div className={styles.line} style={{ width }} />;
}

export function SkeletonBlock({
  width,
  height,
  borderRadius,
}: {
  width: string | number;
  height: string | number;
  borderRadius?: string | number;
}) {
  return <div className={styles.block} style={{ width, height, borderRadius }} />;
}

export function SkeletonTable({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r} className={styles.tableRow}>
            {Array.from({ length: columns }, (_, c) => (
              <td key={c}>
                <div className={styles.tableCell} style={{ width: c === 0 ? "40%" : `${30 + ((r + c) % 3) * 15}%` }} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CollectionsSkeleton() {
  return (
    <div className={styles.wrapper}>
      <SkeletonLine width="200px" />
      <SkeletonTable rows={8} columns={6} />
    </div>
  );
}

export function JobsSkeleton() {
  return (
    <div className={styles.wrapper}>
      <SkeletonLine width="150px" />
      <SkeletonTable rows={6} columns={5} />
    </div>
  );
}

export function UsersSkeleton() {
  return (
    <div className={styles.wrapper}>
      <SkeletonLine width="150px" />
      <SkeletonTable rows={6} columns={5} />
    </div>
  );
}

export function EventsSkeleton() {
  return (
    <div className={styles.wrapper}>
      <SkeletonLine width="150px" />
      <SkeletonTable rows={8} columns={3} />
    </div>
  );
}

export function MediaSkeleton() {
  return (
    <div className={styles.wrapper}>
      <SkeletonLine width="150px" />
      <SkeletonTable rows={8} columns={4} />
    </div>
  );
}

export function RulesSkeleton() {
  return (
    <div className={styles.wrapper}>
      <SkeletonLine width="150px" />
      <SkeletonTable rows={5} columns={5} />
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className={styles.wrapper}>
      <SkeletonLine width="80px" />
      <div className={styles.detailLayout}>
        <div className={styles.detailPoster} />
        <div className={styles.detailBody}>
          <SkeletonLine width="60%" />
          <SkeletonLine width="40%" />
          <SkeletonLine width="80%" />
          <SkeletonLine width="50%" />
        </div>
      </div>
    </div>
  );
}
