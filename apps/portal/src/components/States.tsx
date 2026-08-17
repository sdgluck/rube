import type { ReactNode } from "react";

/* ─── The three things every async surface needs ─────────────────────────────
 *
 * The portal had one of them, spelled `<p class="muted">Loading…</p>` at five
 * call sites, and no error state at all — a failed request rendered the empty
 * state, so "the server is unreachable" and "you have no collections yet" were
 * the same screen. That is the worst possible confusion to hand somebody who
 * cannot see a log.
 */

/** A placeholder shaped like the rows it stands in for, not a spinner. */
export function RowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="state" role="alert">
      <p className="state-title">That didn't load</p>
      <p className="muted">{message || "The server didn't answer. It may be restarting."}</p>
      {onRetry && (
        <button type="button" className="btn-ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <p className="state-title">{title}</p>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}
