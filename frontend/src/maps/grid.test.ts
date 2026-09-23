import { describe, expect, it } from "vitest";
import { bboxParam, boxRing, fromOl, olExtent, resolutions, scaleBar, toOl } from "./grid";

describe("pixel grid", () => {
  it("halves the resolution per zoom level down to full resolution", () => {
    expect(resolutions(3)).toEqual([8, 4, 2, 1]);
    expect(resolutions(0)).toEqual([1]);
  });

  it("puts the map below the origin with y flipped", () => {
    expect(olExtent({ width: 1000, height: 600 })).toEqual([0, -600, 1000, 0]);
    expect(toOl(10, 20)).toEqual([10, -20]);
    expect(fromOl([10, -20])).toEqual([10, 20]);
  });

  it("builds a closed ring for a box", () => {
    expect(boxRing(10, 20, 4, 2)).toEqual([
      [10, -20],
      [14, -20],
      [14, -22],
      [10, -22],
      [10, -20],
    ]);
  });

  it("turns a view extent into a clamped bbox in map pixels", () => {
    expect(bboxParam([-50, -700, 400, 10], { width: 1000, height: 600 })).toBe("0,0,400,600");
    expect(bboxParam([2000, -100, 3000, 0], { width: 1000, height: 600 })).toBeNull();
  });

  it("picks a round scale-bar length", () => {
    // 1 map px per screen px at 3 cm/px: 120 screen px = 3.6 m, rounds down to 2 m = 66.7 px
    expect(scaleBar(1, 3)).toEqual({ px: 67, label: "2 m" });
    expect(scaleBar(64, 3)).toEqual({ px: 104, label: "200 m" });
    expect(scaleBar(1024, 3)).toEqual({ px: 65, label: "2 km" });
    expect(scaleBar(1, null)).toBeNull();
  });
});
