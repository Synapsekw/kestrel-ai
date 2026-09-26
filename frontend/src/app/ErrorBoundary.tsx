import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, Icon } from "@/ui";
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
      <div className="flex h-full w-full items-center justify-center bg-bg p-8 text-ink">
        <div
          role="alert"
          className="flex max-w-xl flex-col gap-4 rounded-lg border border-line bg-surface p-6 shadow-float"
        >
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-danger-soft text-danger">
              <Icon name="warning" size={16} />
            </span>
            <h1 className="text-base font-semibold">Something went wrong</h1>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">{this.state.message}</p>
          <p className="text-sm text-muted">
            Reloading brings the app back; nothing on disk is lost. Copy the diagnostics first if you want to
            report the problem.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload the app
            </Button>
            <Button onClick={() => void navigator.clipboard.writeText(collectDiagnostics())}>
              Copy diagnostics
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
