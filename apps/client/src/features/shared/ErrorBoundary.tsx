/**
 * ErrorBoundary — catches React errors and shows a recovery UI.
 */
import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  readonly children: ReactNode;
  readonly onReset?: () => void;
}

interface State {
  readonly hasError: boolean;
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] flex items-center justify-center">
          <div className="text-center space-y-4 max-w-md px-6">
            <h1 className="text-2xl font-black text-[var(--color-error)]">
              Something went wrong
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)] font-body">
              {this.state.error?.message ?? 'An unexpected error occurred'}
            </p>
            <button
              type="button"
              onClick={this.handleReset}
              className="
                px-6 py-2.5 rounded-[var(--radius-md)] font-semibold text-sm font-body
                bg-[var(--color-accent)] text-[var(--color-text-inverse)]
                hover:brightness-110 cursor-pointer
              "
            >
              Return to Setup
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
