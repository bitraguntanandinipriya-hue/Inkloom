import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { formatReadableFirestoreError } from '../lib/FirebaseContext';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: formatReadableFirestoreError(error),
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[var(--ink-bg)] text-[var(--ink-text)] flex items-center justify-center p-6">
          <div className="max-w-lg w-full rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] p-6 space-y-4">
            <div className="flex items-center gap-2.5 text-[var(--ink-accent)]">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h1 className="font-lora text-lg font-semibold text-[var(--ink-text)]">
                Workspace Interrupted
              </h1>
            </div>
            <p className="text-sm text-[var(--ink-text-muted)] leading-relaxed break-words">
              {this.state.message || 'An unexpected error occurred while syncing your workspace.'}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                window.location.reload();
              }}
              className="px-4 py-2 rounded-lg bg-[var(--ink-accent)] text-white text-sm font-medium inline-flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Reload Inkloom</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
