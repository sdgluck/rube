import sharedStyles from "#/styles/shared.module.css";
import styles from "./Skeleton.module.css";

export function SkeletonLine({ width = "100%" }: { width?: string | number }) {
  return <div className={styles.line} style={{ width }} />;
}

/* The `borderRadius` prop is gone. Callers used to pass 6, 8 or 10 to match
   whatever the block was standing in for; every one of those corners is now
   the same 2px, so the radius belongs in Skeleton.module.css where it can
   follow the token instead of being restated at ten call sites. */
export function SkeletonBlock({ width, height }: { width: string | number; height: string | number }) {
  return <div className={styles.block} style={{ width, height }} />;
}

/**
 * The filter bar a list page carries above its table: a search field, then
 * however many selects and buttons that page has. Real `.filters` geometry, so
 * the row it stands in for is the same height and the same distance above the
 * table.
 */
export function SkeletonToolbar({ controls = 2 }: { controls?: number }) {
  return (
    <div className={sharedStyles.filters} aria-hidden="true">
      <div className={styles.searchControl} />
      {Array.from({ length: controls }, (_, i) => (
        <div key={i} className={styles.control} style={{ width: 92 + (i % 3) * 26 }} />
      ))}
    </div>
  );
}

/**
 * Geometry comes from the real `.table` and `.table-scroll` rather than a copy
 * of them: same card, same 32px header row, same 38px body rows. The skeleton
 * used to render a bare `<tbody>` with no header and no card, so the table
 * gained a header row and grew a surface around it the moment the data landed —
 * nothing *moved*, which is why this never showed up as a layout shift, but the
 * page visibly rearranged.
 */
export function SkeletonTable({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="table-scroll">
      <table className={`${sharedStyles.table} ${styles.table}`} aria-hidden="true">
        <thead>
          <tr>
            {Array.from({ length: columns }, (_, c) => (
              <th key={c}>
                <div className={styles.headCell} style={{ width: `${44 + (c % 3) * 14}%` }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: columns }, (_, c) => (
                <td key={c}>
                  <div
                    className={styles.tableCell}
                    style={{ width: c === 0 ? "40%" : `${30 + ((r + c) % 3) * 15}%` }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Toolbar over table — the shape every list page resolves to. */
function ListSkeletonPage({ rows, columns, controls }: { rows: number; columns: number; controls: number }) {
  return (
    <>
      <SkeletonToolbar controls={controls} />
      <SkeletonTable rows={rows} columns={columns} />
    </>
  );
}

/* Row and column counts track what each page actually renders, so the table
   doesn't change width or depth when the data arrives. */

export function CollectionsSkeleton() {
  return <ListSkeletonPage rows={8} columns={7} controls={4} />;
}

export function JobsSkeleton() {
  return <ListSkeletonPage rows={6} columns={5} controls={2} />;
}

export function UsersSkeleton() {
  return <ListSkeletonPage rows={6} columns={6} controls={1} />;
}

export function EventsSkeleton() {
  return <ListSkeletonPage rows={8} columns={4} controls={2} />;
}

export function MediaSkeleton() {
  return <ListSkeletonPage rows={8} columns={5} controls={4} />;
}

export function RulesSkeleton() {
  return <ListSkeletonPage rows={5} columns={5} controls={2} />;
}

export function PrerollsSkeleton() {
  return (
    <div className={styles.wrapper}>
      <SkeletonLine width="150px" />
      <SkeletonBlock width="100%" height={120} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 16,
          marginTop: 20,
        }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBlock key={i} width="100%" height={200} />
        ))}
      </div>
    </div>
  );
}

export function FormSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className={styles.wrapper}>
      <SkeletonLine width="180px" />
      <div style={{ height: 8 }} />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.formRow}>
          <SkeletonLine width="120px" />
          <SkeletonBlock width="100%" height={36} />
        </div>
      ))}
      <div style={{ height: 8 }} />
      <SkeletonBlock width="120px" height={36} />
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className={styles.wrapper}>
      <SkeletonLine width="200px" />
      <SkeletonLine width="60%" />
      <div style={{ height: 8 }} />
      <SkeletonBlock width="100%" height={120} />
      <SkeletonBlock width="100%" height={240} />
    </div>
  );
}

export function StatsSkeleton() {
  return (
    <div className={styles.wrapper}>
      <SkeletonLine width="160px" />
      <div className={styles.statsGrid}>
        {Array.from({ length: 8 }, (_, i) => (
          <SkeletonBlock key={i} width="100%" height={92} />
        ))}
      </div>
      <SkeletonBlock width="100%" height={220} />
      <SkeletonBlock width="100%" height={220} />
    </div>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className={styles.wrapper}>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonBlock key={i} width="100%" height={56} />
      ))}
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
