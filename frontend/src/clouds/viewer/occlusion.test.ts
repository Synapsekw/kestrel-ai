import { describe, expect, it } from "vitest";
import { hitsNear, isOccluded, occlusionWindows, toDevicePixel, windowOf } from "./occlusion";

describe("occlusionWindows", () => {
  it("a landscape canvas gets a left and a right window, each the half's short side", () => {
    const w = occlusionWindows(1600, 900, 1);
    expect(w).toHaveLength(2);
    expect(w[0]).toEqual({ centre: [400, 450], cssSize: 800, size: 800, origin: [0, 50] });
    expect(w[1].centre).toEqual([1200, 450]);
    expect(w[1].origin).toEqual([800, 50]);
  });

  it("a portrait canvas gets a top and a bottom window; device pixels follow the ratio", () => {
    const w = occlusionWindows(600, 1000, 1.5);
    expect(w[0].cssSize).toBe(500);
    expect(w[0].size).toBe(750);
    expect(w[0].centre).toEqual([450, 1125]);
    expect(w[1].centre).toEqual([450, 375]);
  });
});

describe("placing a point", () => {
  const windows = occlusionWindows(1600, 900, 1);
  it("NDC to device pixels, y up, and into its window", () => {
    const px = toDevicePixel({ x: -0.5, y: 0, z: 0.5 }, 1600, 900)!;
    expect(px).toEqual([400, 450]);
    const w = windowOf(px, windows);
    expect(w).toEqual({ index: 0, col: 400, row: 400 });
  });

  it("a point behind the camera or outside both windows is not placed", () => {
    expect(toDevicePixel({ x: 0, y: 0, z: 1.2 }, 1600, 900)).toBeNull();
    expect(toDevicePixel({ x: 3, y: 0, z: 0.5 }, 1600, 900)).toBeNull();
    // inside the canvas but in the strip above the square window
    expect(windowOf([400, 880], windows)).toBeNull();
  });
});

describe("hitsNear", () => {
  it("decodes only lit pixels within the radius, once per point", () => {
    const size = 9;
    const rgba = new Uint8Array(4 * size * size);
    const put = (col: number, row: number, pcIndex: number, pIndex: number) => {
      const k = 4 * (row * size + col);
      rgba.set([pIndex & 255, (pIndex >> 8) & 255, (pIndex >> 16) & 255, pcIndex + 1], k);
    };
    put(4, 4, 0, 7);
    put(5, 4, 0, 7); // the same point on two pixels
    put(6, 6, 2, 70000); // within 3 px (dist 2.83)
    put(8, 8, 1, 3); // outside (dist 5.66)
    const got = hitsNear(rgba, size, 4, 4, 3);
    expect(got).toEqual([
      { pcIndex: 0, pIndex: 7 },
      { pcIndex: 2, pIndex: 70000 },
    ]);
  });
});

describe("isOccluded", () => {
  const cam: [number, number, number] = [0, 0, 0];
  it("is occluded when a drawn point is nearer than the pin by more than the tolerance", () => {
    expect(isOccluded(cam, [0, 10, 0], [[0, 9.5, 0]], 0.3)).toBe(true);
    expect(isOccluded(cam, [0, 10, 0], [[0, 9.8, 0]], 0.3)).toBe(false);
    expect(isOccluded(cam, [0, 10, 0], [], 0.3)).toBe(false);
  });
});
