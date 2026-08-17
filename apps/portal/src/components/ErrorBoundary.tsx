import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * The portal had none.
 *
 * The admin app wraps its router in one, so a render error there costs you a
 * page. Here the whole app is one screen, so the same error costs a shared
 * user the entire product — a white page, on the only surface they will ever
 * see, with no route to navigate away to and no console they will open.
 *
 * Reload rather than reset-state: there is one screen, its state came from the
 * server, and "try that again" without re-fetching is a good way to render the
 * same broken thing twice.
 */
interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[portal] render error", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="card">
          <h1 className="title">Something went wrong</h1>
          <p className="lede">
            This page failed to load. Reloading usually fixes it; if it doesn't, tell whoever runs this server.
          </p>
          <p className="err">{this.state.error.message}</p>
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
