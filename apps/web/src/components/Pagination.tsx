import styles from "./Pagination.module.css";

interface PaginationProps {
  page: number;
  totalPages: number;
  /** Total item count, for the "(482 items)" summary. */
  total: number;
  /** Plural noun for the summary, e.g. "collections". */
  noun: string;
  onPageChange: (page: number) => void;
}

/**
 * Shared list pager. Events, Users, Media and Collections each carried a
 * verbatim copy of this markup.
 */
export default function Pagination({ page, totalPages, total, noun, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <nav className={styles.pagination} aria-label="Pagination">
      <button
        type="button"
        className={styles.button}
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
      >
        Previous
      </button>
      <span className={styles.info} aria-live="polite">
        Page {page} of {totalPages} ({total.toLocaleString()} {noun})
      </span>
      <button
        type="button"
        className={styles.button}
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
      >
        Next
      </button>
    </nav>
  );
}
