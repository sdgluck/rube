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
 */
export default function ErrorState({
  title = "Something didn't load",
  error,
  onRetry,
  inline = false,
}: ErrorStateProps) {
  return (
    <div className={inline ? styles.inline : styles.container} role="alert">
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
