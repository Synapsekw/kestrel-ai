import { describe, expect, it } from "vitest";
import { sketchCoords } from "./sketch";

describe("the drawing sketch", () => {
  it("draws nothing without vertices or for a tool that does not draw", () => {
    expect(sketchCoords([], [1, 1], { shape: "line", min: 2 })).toBeNull();
    expect(sketchCoords([[0, 0]], [1, 1], { shape: "none" })).toBeNull();
    expect(sketchCoords([[0, 0]], [1, 1], undefined)).toBeNull();
  });

  it("rubber-bands a line to the pointer", () => {
    expect(
      sketchCoords(
        [
          [0, 0],
          [2, 0],
        ],
        [3, 3],
        { shape: "line", min: 2 },
      ),
    ).toEqual({
      type: "LineString",
      coords: [
        [0, 0],
        [2, 0],
        [3, 3],
      ],
    });
    expect(sketchCoords([[0, 0]], null, { shape: "line", min: 2 })).toEqual({
      type: "LineString",
      coords: [[0, 0]],
    });
  });

  it("closes a polygon through the pointer once it has two vertices", () => {
    expect(sketchCoords([[0, 0]], [1, 0], { shape: "polygon", min: 3 })).toEqual({
      type: "LineString",
      coords: [
        [0, 0],
        [1, 0],
      ],
    });
    expect(
      sketchCoords(
        [
          [0, 0],
          [4, 0],
        ],
        [4, 4],
        { shape: "polygon", min: 3 },
      ),
    ).toEqual({
      type: "Polygon",
      coords: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 0],
      ],
    });
  });
});
