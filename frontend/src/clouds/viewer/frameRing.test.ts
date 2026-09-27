// frontend/src/clouds/viewer/frameRing.test.ts
import { describe, expect, it } from "vitest";
import { FRAME_RING_SIZE, FrameRing, frameInterval } from "./frameRing";

describe("frame ring", () => {
  it("keeps the last 600 frame times, oldest first", () => {
    const r = new FrameRing();
    for (let i = 0; i < FRAME_RING_SIZE + 5; i++) r.push(i);
    const v = r.values();
    expect(v).toHaveLength(600);
    expect(v[0]).toBe(5);
    expect(v[599]).toBe(604);
  });

  it("returns a copy, ignores non-finite or negative values, and clears", () => {
    const r = new FrameRing(3);
    r.push(16);
    r.push(Number.NaN);
    r.push(-1);
    r.push(Infinity);
    const v = r.values();
    v.push(99);
    expect(r.values()).toEqual([16]);
    r.clear();
    expect(r.values()).toEqual([]);
  });

  it("counts only the gap between two chained ticks, and drops a paused window's gap", () => {
    expect(frameInterval(null, 100, true)).toBeNull();
    expect(frameInterval(100, 116, false)).toBeNull(); // first tick after idle
    expect(frameInterval(100, 116, true)).toBe(16);
    expect(frameInterval(100, 700, true)).toBeNull(); // > MAX_FRAME_GAP_MS (500)
    expect(frameInterval(100, 600, true)).toBe(500);
  });
});
