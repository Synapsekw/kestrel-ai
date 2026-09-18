import { describe, it, expect } from "vitest";
import {
  clampRect,
  displayMaxSide,
  dragRect,
  duplicateOffset,
  fitView,
  isDrawable,
  normalizeRect,
  oneToOneView,
  rectEquals,
  roundRect,
  toDisplay,
  toImage,
  zoomAround,
  MAX_SCALE,
  MIN_SCALE,
} from "./geometry";

const image = { width: 4000, height: 2667 };
const viewport = { width: 1000, height: 700 };

describe("view transforms", () => {
  it("converts display to image pixels and back", () => {
    const v = { scale: 0.25, x: 10, y: 20 };
    const p = toImage({ x: 260, y: 220 }, v);
    expect(p).toEqual({ x: 1000, y: 800 });
    expect(toDisplay(p, v)).toEqual({ x: 260, y: 220 });
  });

  it("fits the whole image inside the viewport with padding and centres it", () => {
    const v = fitView(image, viewport, 16);
    expect(v.scale).toBeCloseTo(Math.min(968 / 4000, 668 / 2667), 6);
    const w = image.width * v.scale;
    const h = image.height * v.scale;
    expect(v.x).toBeCloseTo((viewport.width - w) / 2, 6);
    expect(v.y).toBeCloseTo((viewport.height - h) / 2, 6);
  });

  it("1:1 keeps the image point under the viewport centre", () => {
    const fitted = fitView(image, viewport);
    const centreBefore = toImage({ x: 500, y: 350 }, fitted);
    const v = oneToOneView(viewport, fitted);
    expect(v.scale).toBe(1);
    expect(toImage({ x: 500, y: 350 }, v)).toEqual(centreBefore);
  });

  it("zooms around the pointer and clamps the scale", () => {
    const v = { scale: 1, x: 0, y: 0 };
    const at = { x: 100, y: 50 };
    const z = zoomAround(v, at, 2);
    expect(z.scale).toBe(2);
    expect(toImage(at, z)).toEqual(toImage(at, v));
    expect(zoomAround(v, at, 1000).scale).toBe(MAX_SCALE);
    expect(zoomAround(v, at, 0.0001).scale).toBe(MIN_SCALE);
  });
});

describe("rects", () => {
  it("normalises two corners in any order", () => {
    expect(normalizeRect({ x: 10, y: 50 }, { x: 4, y: 20 })).toEqual({ x: 4, y: 20, w: 6, h: 30 });
  });

  it("clamps inside the image and enforces a minimum size", () => {
    expect(clampRect({ x: -5, y: -5, w: 50, h: 50 }, image)).toEqual({ x: 0, y: 0, w: 50, h: 50 });
    expect(clampRect({ x: 3990, y: 2660, w: 50, h: 50 }, image)).toEqual({ x: 3950, y: 2617, w: 50, h: 50 });
    expect(clampRect({ x: 10, y: 10, w: 0, h: 0 }, image)).toEqual({ x: 10, y: 10, w: 2, h: 2 });
  });

  it("rounds to one decimal and compares with tolerance", () => {
    expect(roundRect({ x: 1.26, y: 2.24, w: 3.36, h: 4.06 })).toEqual({ x: 1.3, y: 2.2, w: 3.4, h: 4.1 });
    expect(rectEquals({ x: 1, y: 1, w: 1, h: 1 }, { x: 1.01, y: 1, w: 1, h: 1 })).toBe(true);
    expect(rectEquals({ x: 1, y: 1, w: 1, h: 1 }, { x: 2, y: 1, w: 1, h: 1 })).toBe(false);
  });

  it("knows when a drag is too small to be a box", () => {
    expect(isDrawable({ x: 0, y: 0, w: 1, h: 10 })).toBe(false);
    expect(isDrawable({ x: 0, y: 0, w: 2, h: 2 })).toBe(true);
  });

  it("offsets a duplicate and keeps it inside the image", () => {
    expect(duplicateOffset({ x: 10, y: 10, w: 20, h: 20 }, image)).toEqual({ x: 22, y: 22, w: 20, h: 20 });
    expect(duplicateOffset({ x: 3980, y: 2647, w: 20, h: 20 }, image)).toEqual({
      x: 3980,
      y: 2647,
      w: 20,
      h: 20,
    });
  });

  it("requests at most the display cap as max_side", () => {
    expect(displayMaxSide(image)).toBe(4000);
    expect(displayMaxSide({ width: 6000, height: 4000 })).toBe(4096);
    expect(displayMaxSide({ width: 800, height: 600 }, 2048)).toBe(800);
  });
});

describe("dragRect", () => {
  const v = { scale: 0.25, x: 0, y: 0 };
  it("treats a click or a few pixels of jitter as no box", () => {
    expect(dragRect({ x: 100, y: 100 }, { x: 100, y: 100 }, v, image)).toBeNull();
    expect(dragRect({ x: 100, y: 100 }, { x: 103, y: 102 }, v, image)).toBeNull();
    expect(dragRect({ x: 100, y: 100 }, { x: 140, y: 100 }, v, image)).toBeNull();
  });
  it("returns the clamped, rounded image rect of a real drag in either direction", () => {
    expect(dragRect({ x: 100, y: 100 }, { x: 110, y: 108 }, v, image)).toEqual({
      x: 400,
      y: 400,
      w: 40,
      h: 32,
    });
    expect(dragRect({ x: 110, y: 108 }, { x: 100, y: 100 }, v, image)).toEqual({
      x: 400,
      y: 400,
      w: 40,
      h: 32,
    });
    // starts outside the image: clamped into it, the size is kept
    expect(dragRect({ x: -20, y: -20 }, { x: 10, y: 10 }, v, image)).toEqual({ x: 0, y: 0, w: 120, h: 120 });
  });
});
