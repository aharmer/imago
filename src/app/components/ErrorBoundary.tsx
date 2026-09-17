import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useStore } from '../store';

interface State {
  error: Error | null;
}

/** Keeps a bug in one part of the app from leaving a blank page, and saves work before anything else. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('imagoLabel crashed:', error, info.componentStack);
    void useStore.getState().flushSaves();
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="start">
        <div className="start-inner">
          <h1 className="brand">imagoLabel</h1>
          <div className="notice-box">
            <h2>Something went wrong</h2>
            <p>Your annotations up to this point have been saved to the image folder.</p>
            <p className="muted small">{this.state.error.message}</p>
            <div className="modal-actions start">
              <button className="primary" onClick={() => location.reload()}>
                Reload imagoLabel
              </button>
            </div>
          </div>
          <p className="muted small">
            If this keeps happening, please <a href="https://github.com/aharmer/imagoLabel/issues">report it</a> with what you were doing at the time.
          </p>
        </div>
      </main>
    );
  }
}
