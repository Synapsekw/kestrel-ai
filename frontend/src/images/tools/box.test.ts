import { describe, expect, it } from "vitest";
import { boxDown, boxMove } from "./box";

describe("box machine", () => {
  const view = { scale: 1, x: 0, y: 0 };
  const image = { width: 4000, height: 3000 };

  it("drags a rectangle and ignores jitter", () => {
    let d = boxDown({ x: 10, y: 10 }, { x: 10, y: 10 });
    d = boxMove(d, { x: 12, y: 11 }, view, image);
    expect(d.rect).toBeNull();
    d = boxMove(d, { x: 110, y: 60 }, view, image);
    expect(d.rect).toEqual({ x: 10, y: 10, w: 100, h: 50 });
  });
});
