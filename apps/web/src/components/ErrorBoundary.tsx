import { Component, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import styles from "./ErrorBoundary.module.css";

interface Props {
  children: ReactNode;
  /** Changing this remounts the boundary, clearing a captured error. */
  resetKey?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Did this error come from a lazy route chunk that's no longer on the server?
 *
 * It means the app was rebuilt while this tab was open: the `index.html` in
 * memory names hashed chunks the new build doesn't have. Nothing is broken and
 * there's nothing to report — a reload fetches the current build and fixes it —
 * so it gets its own message rather than the generic "unexpected error" card,
 * which invites bug reports for a deploy that went fine.
 *
 * Each engine words it differently, hence matching several phrasings.
 */
function isStaleChunkError(error: Error | null): boolean {
  const message = error?.message ?? "";
  return (
    /failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /importing a module script failed/i.test(message) ||
    /'text\/plain' is not a valid JavaScript MIME type/i.test(message)
  );
}

class ErrorBoundaryInner extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // Navigating away from a page that threw should get you a working page,
    // not the error screen with a different URL in the address bar.
    if (prev.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      const stale = isStaleChunkError(this.state.error);
      return (
        // The outer div is what `.content > *` styles — it takes the column's
        // height and centres the card, which stays sized to its own content.
        <div className={styles.wrap}>
          <div className={styles.container} role="alert">
            <h2 className={styles.title}>{stale ? "Tinkerbell was updated" : "Something went wrong"}</h2>
            <p className={styles.message}>
              {stale
                ? "This tab is running an older version of the app, so part of it could no longer be loaded. Reloading picks up the new one."
                : "This page hit an unexpected error. Reloading usually clears it; if it keeps happening the details below are worth including in a bug report."}
            </p>
            {/* A stale chunk's message names a hashed filename and nothing else
                actionable, so it's noise on a card that already explains the
                cause and the fix. */}
            {!stale && this.state.error?.message && <pre className={styles.detail}>{this.state.error.message}</pre>}
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => window.location.reload()}>
                Reload page
              </button>
              {/* "Try again" re-renders the same failed import against the same
                  dead URL, so it can only fail again — a reload is the only
                  thing that helps. */}
              {!stale && (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => this.setState({ hasError: false, error: null })}
                >
                  Try again
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Route-aware error boundary: a captured error is cleared on navigation, so a
 * broken page can't strand the whole app.
 */
export default function ErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundaryInner resetKey={pathname}>{children}</ErrorBoundaryInner>;
}
