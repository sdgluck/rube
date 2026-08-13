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
      return (
        // The outer div is what `.content > *` styles — it takes the column's
        // height and centres the card, which stays sized to its own content.
        <div className={styles.wrap}>
          <div className={styles.container} role="alert">
            <h2 className={styles.title}>Something went wrong</h2>
            <p className={styles.message}>
              This page hit an unexpected error. Reloading usually clears it; if it keeps happening the details below
              are worth including in a bug report.
            </p>
            {this.state.error?.message && <pre className={styles.detail}>{this.state.error.message}</pre>}
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => window.location.reload()}>
                Reload page
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => this.setState({ hasError: false, error: null })}
              >
                Try again
              </button>
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
