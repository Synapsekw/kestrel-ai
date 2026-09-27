// frontend/src/clouds/viewer/frameBridge.ts
import type { FrameCallback } from "./types";

export interface FrameSource {
  onFrame(cb: FrameCallback): () => void;
}

/**
 * The shell's `onFrame`: subscribers outlive an engine (a new cloud, "Reload view" build a new
 * one), so the bridge keeps them and re-subscribes each to whichever engine is attached.
 */
export class FrameBridge {
  private readonly subs = new Set<FrameCallback>();
  private readonly live = new Map<FrameCallback, () => void>();
  private source: FrameSource | null = null;

  add(cb: FrameCallback): () => void {
    this.subs.add(cb);
    if (this.source && !this.live.has(cb)) this.live.set(cb, this.source.onFrame(cb));
    return () => {
      this.subs.delete(cb);
      this.live.get(cb)?.();
      this.live.delete(cb);
    };
  }

  attach(source: FrameSource): void {
    this.detach();
    this.source = source;
    for (const cb of this.subs) this.live.set(cb, source.onFrame(cb));
  }

  detach(): void {
    for (const off of this.live.values()) off();
    this.live.clear();
    this.source = null;
  }
}
