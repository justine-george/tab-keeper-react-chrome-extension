import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

// The popup has one job when a render throws: not be a blank rectangle. Before
// this, any unhandled render error unmounted the whole tree and left the user
// with nothing to click and no way to tell a crash from a slow start.
//
// Deliberately mounted OUTSIDE the Redux and i18n providers, and deliberately
// self-contained: no hooks, no theme tokens, no translated strings. A fallback
// that reads from the store or calls t() can throw while rendering, and React
// does not catch an error thrown by a boundary's own fallback -- it unmounts
// the tree and produces exactly the blank screen this exists to prevent. The
// cost is that the message is English-only, which is the right trade for a
// screen the user should only ever see when something is already broken.
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    // `error` is typed unknown because a throw can carry any value, not only
    // an Error -- reading .message off a thrown string would throw again.
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'An unexpected error occurred.';

    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    // Kept so the stack survives in the popup's console for anyone debugging
    // a report. There is nowhere else to send it: the extension has no error
    // reporting backend, and inventing one is not this fix's job.
    console.error('Tab Keeper: render error caught by ErrorBoundary', {
      error,
      componentStack: errorInfo.componentStack,
    });
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          gap: '12px',
          padding: '24px',
          minHeight: '200px',
          fontFamily: 'sans-serif',
          fontSize: '14px',
          color: '#1a1a1a',
          backgroundColor: '#ffffff',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>
          Something went wrong
        </h1>
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          Tab Keeper hit an unexpected error and could not finish loading. Your
          saved sessions are stored separately and have not been changed.
        </p>
        <p
          style={{
            margin: 0,
            fontFamily: 'monospace',
            fontSize: '12px',
            color: '#666666',
            overflowWrap: 'anywhere',
          }}
        >
          {this.state.message}
        </p>
        <button
          type="button"
          onClick={this.handleReload}
          style={{
            padding: '8px 16px',
            border: '1px solid #1a1a1a',
            borderRadius: '4px',
            background: '#ffffff',
            color: '#1a1a1a',
            fontFamily: 'inherit',
            fontSize: 'inherit',
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
