import styles from "./ErrorState.module.css";

interface ErrorStateProps {
  /** What failed, in the user's terms: "Couldn't load collections". */
  title?: string;
  /** The underlying error, if there's one worth showing. */
  error?: { message?: string } | null;
  /** Retry handler — usually a react-query `refetch`. */
  onRetry?: () => void;
  /** Renders inline within a panel rather than as a full-page block. */
  inline?: boolean;
}

/**
 * The counterpart to <EmptyState>, for when a request failed rather than
 * returned nothing.
 *
 * Pages used to render an empty state on error, so "no events found" covered
 * both "you have no events" and "the server is unreachable" — which for a
 * self-hosted app with a misconfigured Plex URL is exactly the wrong message.
 *
 * Two shapes, one voice. A whole page that failed gets the same centred card
 * as <ErrorBoundary>'s "Something went wrong" — a page-sized failure should
 * look the same whether it was a thrown render or a request that never came
 * back. A panel that failed inside a working page keeps the compact red block,
 * because a card in a panel would claim the whole page had failed.
 */
export default function ErrorState({
  title = "Something didn't load",
  error,
  onRetry,
  inline = false,
}: ErrorStateProps) {
  if (inline) {
    return (
      <div className={styles.inline} role="alert">
        <div className={styles.block}>
          <span className={styles.icon} aria-hidden="true" />
          <div>
            <p className={styles.title}>{title}</p>
            {error?.message && <p className={styles.detail}>{error.message}</p>}
          </div>
        </div>
        {onRetry && (
          <button type="button" className={styles.retry} onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.panel} role="alert">
        <h2 className={styles.cardTitle}>{title}</h2>
        {error?.message && <pre className={styles.cardDetail}>{error.message}</pre>}
        <div className={styles.cardActions}>
          {onRetry && (
            <button type="button" className={styles.cardPrimary} onClick={onRetry}>
              Try again
            </button>
          )}
          <button type="button" className={styles.cardSecondary} onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}
