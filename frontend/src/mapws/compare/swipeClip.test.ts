import { describe, expect, it, vi } from "vitest";
import {
  attachSwipeClip,
  clampSwipe,
  swipeClipRect,
  swipeFromPointer,
} from "./swipeClip";

describe("swipe maths (M §15)", () => {
  it("clamps the divider to 2–98 % and survives NaN", () => {
    expect(clampSwipe(0)).toBe(2);
    expect(clampSwipe(100)).toBe(98);
    expect(clampSwipe(37.5)).toBe(37.5);
    expect(clampSwipe(Number.NaN)).toBe(50);
  });

  it("splits the map at the divider for each side, in CSS pixels", () => {
    expect(swipeClipRect([800, 600], 25, "left")).toEqual([0, 0, 200, 600]);
    expect(swipeClipRect([800, 600], 25, "right")).toEqual([200, 0, 800, 600]);
    expect(swipeClipRect([800, 600], 1, "left")).toEqual([0, 0, 16, 600]);
  });

  it("turns a pointer x into a clamped percentage", () => {
    expect(swipeFromPointer(300, 100, 400)).toBe(50);
    expect(swipeFromPointer(90, 100, 400)).toBe(2);
    expect(swipeFromPointer(10, 0, 0)).toBe(50);
  });
});

function fakeLayer() {
  const handlers: Record<string, (e: unknown) => void> = {};
  return {
    handlers,
    on: vi.fn(
      (type: string, f: (e: unknown) => void) => void (handlers[type] = f),
    ),
    un: vi.fn((type: string) => void delete handlers[type]),
  };
}

function fakeCtx() {
  const calls: string[] = [];
  const rec =
    (name: string) =>
    (...args: number[]) =>
      void calls.push(`${name}(${args.join(",")})`);
  return {
    calls,
    save: rec("save"),
    restore: rec("restore"),
    beginPath: rec("beginPath"),
    moveTo: rec("moveTo"),
    lineTo: rec("lineTo"),
    closePath: rec("closePath"),
    clip: rec("clip"),
  };
}

describe("attachSwipeClip", () => {
  it("clips the canvas to the side's rectangle in render pixels, then restores", () => {
    const layer = fakeLayer();
    const ctx = fakeCtx();
    const detach = attachSwipeClip(layer as never, "left", () => 50);
    // pixel ratio 2: the inverse pixel transform scales CSS pixels by 2
    const event = {
      context: ctx,
      frameState: { size: [200, 100] },
      inversePixelTransform: [2, 0, 0, 2, 0, 0],
    };
    layer.handlers.prerender(event);
    layer.handlers.postrender(event);
    expect(ctx.calls).toEqual([
      "save()",
      "beginPath()",
      "moveTo(0,0)",
      "lineTo(200,0)",
      "lineTo(200,200)",
      "lineTo(0,200)",
      "closePath()",
      "clip()",
      "restore()",
    ]);
    detach();
    expect(layer.un).toHaveBeenCalledTimes(2);
  });

  it("reads the divider at render time and never restores what it did not save", () => {
    const layer = fakeLayer();
    const ctx = fakeCtx();
    let pct = 50;
    attachSwipeClip(layer as never, "right", () => pct);
    pct = 75;
    layer.handlers.prerender({
      context: ctx,
      frameState: { size: [400, 100] },
      inversePixelTransform: [1, 0, 0, 1, 0, 0],
    });
    expect(ctx.calls[2]).toBe("moveTo(300,0)");
    const bare = fakeCtx();
    layer.handlers.prerender({
      context: bare,
      frameState: null,
      inversePixelTransform: [1, 0, 0, 1, 0, 0],
    });
    layer.handlers.postrender({ context: bare });
    expect(bare.calls).toEqual([]);
  });
});
