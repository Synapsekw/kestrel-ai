import { Component, type ReactNode } from "react";
import { pushLog } from "@/app/diagnostics";

/**
 * Catches what a 3D preview throws past its own no-WebGL fallback (an engine error, a chunk that
 * failed to load), logs it and shows `fallback`, so a broken preview never takes the whole app down.
 */
export class PreviewBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onError: () => void; what: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    pushLog(`${this.props.what} preview failed: ${error.message}`);
    this.props.onError();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
