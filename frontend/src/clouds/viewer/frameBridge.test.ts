// frontend/src/clouds/viewer/frameBridge.test.ts
import { describe, expect, it, vi } from "vitest";
import { FrameBridge, type FrameSource } from "./frameBridge";
import type { FrameCallback, FrameCamera } from "./types";

function fakeSource() {
  const subs = new Set<FrameCallback>();
  const src: FrameSource = {
    onFrame(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
  const emit = () => subs.forEach((cb) => cb({} as FrameCamera));
  return { src, subs, emit };
}

describe("frame bridge", () => {
  it("subscribes callbacks added before and after an engine attaches", () => {
    const bridge = new FrameBridge();
    const early = vi.fn();
    bridge.add(early);
    const a = fakeSource();
    bridge.attach(a.src);
    const late = vi.fn();
    bridge.add(late);
    a.emit();
    expect(early).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("moves every subscriber to a new engine and none stays on the disposed one", () => {
    const bridge = new FrameBridge();
    const cb = vi.fn();
    const off = bridge.add(cb);
    const a = fakeSource();
    bridge.attach(a.src);
    bridge.detach();
    expect(a.subs.size).toBe(0);
    const b = fakeSource();
    bridge.attach(b.src);
    b.emit();
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    expect(b.subs.size).toBe(0);
    b.emit();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("an unsubscribe while detached never reaches a later engine", () => {
    const bridge = new FrameBridge();
    const cb = vi.fn();
    const off = bridge.add(cb);
    off();
    const a = fakeSource();
    bridge.attach(a.src);
    expect(a.subs.size).toBe(0);
  });
});
