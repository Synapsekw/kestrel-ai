import { describe, expect, it } from "vitest";
import { lengthDown, lengthMove } from "./length";

describe("length machine", () => {
  it("click, click commits the two ends", () => {
    const first = lengthDown(null, { x: 0, y: 0 }, false);
    expect(first.commit).toBeNull();
    const second = lengthDown(first.draft, { x: 30, y: 40 }, false);
    expect(second.commit).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 40 },
    ]);
    expect(second.draft).toBeNull();
  });

  it("Shift constrains to 0/45/90 degrees", () => {
    const d = lengthDown(null, { x: 0, y: 0 }, false).draft!;
    const moved = lengthMove(d, { x: 100, y: 10 }, true);
    expect(moved.b!.y).toBeCloseTo(0);
    const diag = lengthMove(d, { x: 100, y: 90 }, true);
    expect(diag.b!.x).toBeCloseTo(diag.b!.y);
    const done = lengthDown(moved, { x: 100, y: 10 }, true);
    expect(done.commit![1].y).toBeCloseTo(0);
  });

  it("a second click on the first point does not commit", () => {
    const d = lengthDown(null, { x: 5, y: 5 }, false).draft;
    expect(lengthDown(d, { x: 5.2, y: 5 }, false).commit).toBeNull();
  });
});
