import { Component, type ErrorInfo, type ReactNode } from "react";
import { collectDiagnostics, pushLog } from "./diagnostics";

interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    pushLog(`ui error: ${error.message}`);
    pushLog(`ui stack: ${info.componentStack ?? ""}`);
  }

  render() {
    if (this.state.message === null) return this.props.children;
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-900 p-8 text-slate-100">
        <div className="max-w-xl rounded-lg bg-slate-800 p-6 shadow-xl">
          <h1 className="mb-2 text-xl font-semibold text-orange-400">Something went wrong</h1>
          <p className="mb-6 whitespace-pre-wrap text-sm text-slate-300">{this.state.message}</p>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(collectDiagnostics())}
            className="rounded bg-orange-600 px-4 py-2 font-medium hover:bg-orange-500"
          >
            Copy diagnostics
          </button>
        </div>
      </div>
    );
  }
}
