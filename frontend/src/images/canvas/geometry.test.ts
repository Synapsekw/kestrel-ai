import { describe, it, expect } from "vitest";
import {
  aabbOf,
  centreOf,
  clampOriented,
  clampPoint,
  clampRect,
  cornersOf,
  displayMaxSide,
  distance,
  dragRect,
  duplicateOffset,
  envelopeOf,
  fitView,
  flatten,
  fromPoints,
  isDrawable,
  nearestEdge,
  normaliseAngle,
  normalizeRect,
  oneToOneView,
  orientedEquals,
  rboxFromThreePoints,
  rectEquals,
  roundRect,
  snapDirection,
  toDisplay,
  toImage,
  toPoints,
  translatePoints,
  zoomAround,
  MAX_SCALE,
  MIN_SCALE,
} from "./geometry";
import fixtures from "../../../../contract/fixtures/oriented-boxes.json";

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
  const anchor = (p: { x: number; y: number }) => toImage(p, v);
  it("treats a click or a few pixels of jitter as no box", () => {
    const start = { x: 100, y: 100 };
    expect(dragRect(anchor(start), start, { x: 100, y: 100 }, v, image)).toBeNull();
    expect(dragRect(anchor(start), start, { x: 103, y: 102 }, v, image)).toBeNull();
    expect(dragRect(anchor(start), start, { x: 140, y: 100 }, v, image)).toBeNull();
  });
  it("returns the clamped, rounded image rect of a real drag in either direction", () => {
    const a = { x: 100, y: 100 };
    const b = { x: 110, y: 108 };
    expect(dragRect(anchor(a), a, b, v, image)).toEqual({ x: 400, y: 400, w: 40, h: 32 });
    expect(dragRect(anchor(b), b, a, v, image)).toEqual({ x: 400, y: 400, w: 40, h: 32 });
    // starts outside the image: clamped into it, the size is kept
    const out = { x: -20, y: -20 };
    expect(dragRect(anchor(out), out, { x: 10, y: 10 }, v, image)).toEqual({ x: 0, y: 0, w: 120, h: 120 });
  });
  it("keeps the anchor at the same image pixel when the view changes mid-drag", () => {
    const start = { x: 100, y: 100 };
    const a = anchor(start); // image (400, 400) under the first view
    const zoomed = { scale: 0.5, x: -300, y: -300 }; // display (100,100) is now image (800, 800)
    const rect = dragRect(a, start, { x: 150, y: 140 }, zoomed, image);
    expect(rect).toEqual({ x: 400, y: 400, w: 500, h: 480 });
  });
});

describe("oriented boxes", () => {
  const box = { x: 10, y: 20, w: 30, h: 40, angle: 0 };

  it("normalises degrees into [0, 180)", () => {
    expect(normaliseAngle(0)).toBe(0);
    expect(normaliseAngle(190)).toBeCloseTo(10, 9);
    expect(normaliseAngle(-10)).toBeCloseTo(170, 9);
    expect(normaliseAngle(180)).toBe(0);
    expect(normaliseAngle(360)).toBe(0);
  });

  it("takes the centre of the unrotated box", () => {
    expect(centreOf(box)).toEqual({ x: 25, y: 40 });
  });

  it("gives the plain rectangle's corners at angle 0", () => {
    expect(cornersOf(box)).toEqual([
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 60 },
      { x: 10, y: 60 },
    ]);
  });

  it("swaps the footprint at 90 degrees", () => {
    const a = aabbOf({ ...box, angle: 90 });
    expect(a.x).toBeCloseTo(5, 6);
    expect(a.y).toBeCloseTo(25, 6);
    expect(a.w).toBeCloseTo(40, 6);
    expect(a.h).toBeCloseTo(30, 6);
  });

  it("keeps the centre and the side lengths under rotation", () => {
    const c = cornersOf({ ...box, angle: 37 });
    const mx = c.reduce((s, p) => s + p.x, 0) / 4;
    const my = c.reduce((s, p) => s + p.y, 0) / 4;
    expect(mx).toBeCloseTo(25, 6);
    expect(my).toBeCloseTo(40, 6);
    expect(Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y)).toBeCloseTo(30, 6);
    expect(Math.hypot(c[2].x - c[1].x, c[2].y - c[1].y)).toBeCloseTo(40, 6);
  });

  it("clamps a rotated box by its centre, not its corners", () => {
    const image = { width: 320, height: 240 };
    // Hangs 20px off the right edge; the centre is well inside, so it stays put.
    const kept = clampOriented({ x: 280, y: 10, w: 60, h: 20, angle: 30 }, image);
    expect(kept.x).toBe(280);
    // Centre at 430 is outside; it is pulled back so the centre lands on the edge.
    const pulled = clampOriented({ x: 400, y: 10, w: 60, h: 20, angle: 30 }, image);
    expect(pulled.x + pulled.w / 2).toBeCloseTo(320, 6);
  });

  it("clamps an angle-0 box exactly as clampRect does", () => {
    const image = { width: 320, height: 240 };
    const r = { x: 300, y: 10, w: 60, h: 20, angle: 0 };
    const { angle, ...plain } = clampOriented(r, image);
    expect(angle).toBe(0);
    expect(plain).toEqual(clampRect({ x: 300, y: 10, w: 60, h: 20 }, image));
  });

  it("compares angle as well as geometry", () => {
    expect(orientedEquals({ ...box, angle: 30 }, { ...box, angle: 30 })).toBe(true);
    expect(orientedEquals({ ...box, angle: 30 }, { ...box, angle: 31 })).toBe(false);
    expect(orientedEquals({ ...box, angle: 30 }, { ...box, angle: 30.01 })).toBe(true);
  });
});

describe("shared corner fixtures", () => {
  it.each(fixtures.cases)("agrees with the Python implementation for $name", (c) => {
    const got = cornersOf(c.box);
    c.corners.forEach(([x, y], i) => {
      expect(got[i].x).toBeCloseTo(x, 9);
      expect(got[i].y).toBeCloseTo(y, 9);
    });
    const a = aabbOf(c.box);
    expect(a.x).toBeCloseTo(c.aabb.x, 9);
    expect(a.y).toBeCloseTo(c.aabb.y, 9);
    expect(a.w).toBeCloseTo(c.aabb.w, 9);
    expect(a.h).toBeCloseTo(c.aabb.h, 9);
  });
});

describe("three-point rotated box (I-D8)", () => {
  it("builds an axis-aligned box from an edge and a width point", () => {
    expect(rboxFromThreePoints({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 40 })).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 40,
      angle: 0,
    });
  });

  it("puts the width on the side of the third point", () => {
    const r = rboxFromThreePoints({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: -40 })!;
    expect(r).toMatchObject({ x: 0, y: -40, w: 100, h: 40, angle: 0 });
  });

  it("keeps the drawn edge as a real edge at 90 degrees", () => {
    const r = rboxFromThreePoints({ x: 0, y: 0 }, { x: 0, y: 100 }, { x: -30, y: 50 })!;
    expect(r.angle).toBeCloseTo(90);
    expect(r.w).toBeCloseTo(100);
    expect(r.h).toBeCloseTo(30);
    const corners = cornersOf(r);
    expect(corners.some((c) => Math.abs(c.x) < 1e-9 && Math.abs(c.y) < 1e-9)).toBe(true);
    expect(corners.some((c) => Math.abs(c.x) < 1e-9 && Math.abs(c.y - 100) < 1e-9)).toBe(true);
  });

  it("the reversed stroke gives the same rectangle", () => {
    const a = { x: 10, y: 20 };
    const b = { x: 110, y: 78 };
    const c = { x: 80, y: 120 };
    const forward = rboxFromThreePoints(a, b, c)!;
    const reversed = rboxFromThreePoints(b, a, c)!;
    expect(reversed.angle).toBeCloseTo(forward.angle);
    expect(reversed.angle).toBeGreaterThanOrEqual(0);
    expect(reversed.angle).toBeLessThan(180);
    for (const k of ["x", "y", "w", "h"] as const) expect(reversed[k]).toBeCloseTo(forward[k]);
    expect(forward.h).toBeGreaterThan(0);
  });

  it("refuses a degenerate edge or width", () => {
    expect(rboxFromThreePoints({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 30 })).toBeNull();
    expect(rboxFromThreePoints({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 1 })).toBeNull();
  });
});

describe("snaps", () => {
  it("snaps a direction to the step and keeps the length", () => {
    const b = snapDirection({ x: 0, y: 0 }, { x: 100, y: 12 }, 15);
    expect(b.y).toBeCloseTo(0);
    expect(distance({ x: 0, y: 0 }, b)).toBeCloseTo(Math.hypot(100, 12));
    const diag = snapDirection({ x: 0, y: 0 }, { x: 50, y: 47 }, 45);
    expect(diag.x).toBeCloseTo(diag.y);
  });
});

describe("polygon helpers", () => {
  const square = [
    { x: 10, y: 10 },
    { x: 50, y: 10 },
    { x: 50, y: 30 },
    { x: 10, y: 30 },
  ];

  it("round-trips API points and flattens for Konva", () => {
    expect(toPoints([[1, 2], [3, 4]])).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    expect(fromPoints([{ x: 1.04, y: 2.06 }])).toEqual([[1, 2.1]]);
    expect(flatten(square)).toEqual([10, 10, 50, 10, 50, 30, 10, 30]);
  });

  it("gives the envelope", () => {
    expect(envelopeOf(square)).toEqual({ x: 10, y: 10, w: 40, h: 20 });
  });

  it("finds the nearest edge and the foot point", () => {
    const hit = nearestEdge(square, { x: 30, y: 12 })!;
    expect(hit.index).toBe(0);
    expect(hit.distance).toBeCloseTo(2);
    expect(hit.at).toEqual({ x: 30, y: 10 });
    const closing = nearestEdge(square, { x: 8, y: 20 })!;
    expect(closing.index).toBe(3); // the edge from the last vertex back to the first
  });

  it("translates and clamps", () => {
    expect(translatePoints(square, 5, -5)[0]).toEqual({ x: 15, y: 5 });
    expect(clampPoint({ x: -3, y: 120 }, { width: 100, height: 100 })).toEqual({ x: 0, y: 100 });
  });
});
