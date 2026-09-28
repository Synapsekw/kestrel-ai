import { describe, expect, it } from "vitest";
import {
  centroid,
  closeRing,
  dedupe,
  distanceAlong,
  inExtent,
  openRing,
  pointAlong,
  polylineLength,
  ringArea,
  ringPerimeter,
} from "./planar";

const square = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe("planar geometry", () => {
  it("measures a 3-4-5 line", () => {
    expect(
      polylineLength([
        [0, 0],
        [3, 4],
      ]),
    ).toBe(5);
    expect(polylineLength([[0, 0]])).toBe(0);
  });

  it("a double-click duplicate does not change the length", () => {
    const pts = dedupe([
      [0, 0],
      [3, 4],
      [3, 4],
    ]);
    expect(pts).toEqual([
      [0, 0],
      [3, 4],
    ]);
    expect(polylineLength(pts)).toBe(5);
  });

  it("opens and closes rings without doubling the closing vertex", () => {
    expect(closeRing(square)).toHaveLength(5);
    expect(closeRing(closeRing(square))).toHaveLength(5);
    expect(openRing(closeRing(square))).toEqual(square);
  });

  it("area and perimeter ignore winding and closure", () => {
    expect(ringArea(square)).toBe(100);
    expect(ringArea([...square].reverse())).toBe(100);
    expect(ringArea(closeRing(square))).toBe(100);
    expect(ringPerimeter(square)).toBe(40);
  });

  it("the centroid of an L shape is its area centroid, not the vertex mean", () => {
    const l = [
      [0, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 2],
      [0, 2],
    ];
    const [x, y] = centroid(l);
    expect(x).toBeCloseTo(5 / 6, 9);
    expect(y).toBeCloseTo(5 / 6, 9);
    expect(centroid([[4, 4]])).toEqual([4, 4]);
  });

  it("tests points against an extent, edges included", () => {
    expect(inExtent([5, 5], [0, 0, 10, 10])).toBe(true);
    expect(inExtent([10, 10], [0, 0, 10, 10])).toBe(true);
    expect(inExtent([15, 5], [0, 0, 10, 10])).toBe(false);
  });

  it("walks along a line and back", () => {
    const line = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    expect(pointAlong(line, 15)).toEqual([10, 5]);
    expect(pointAlong(line, -1)).toEqual([0, 0]);
    expect(pointAlong(line, 99)).toEqual([10, 10]);
    expect(distanceAlong(line, [10.5, 5])).toBeCloseTo(15, 9);
    expect(distanceAlong(line, [4, -3])).toBeCloseTo(4, 9);
  });
});
