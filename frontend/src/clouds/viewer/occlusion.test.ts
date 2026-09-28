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

  it("ignores a nearer point beside the line of sight: the pin's own surface seen obliquely", () => {
    // 1 m nearer along the line of sight but 1 m off it: a surface through the pin at 45°, not a
    // point in front of it (it would need to be more than 0.3 + 2 × 1 m nearer)
    expect(isOccluded(cam, [0, 10, 0], [[1, 9, 0]], 0.3)).toBe(false);
    expect(isOccluded(cam, [0, 10, 0], [[1, 7.5, 0]], 0.3)).toBe(true);
  });

  // Task 17, the chimney (21.7 M points) with the whole cloud in view (about 1.7 m per pixel, so the
  // 3 px disk is about 5 m across): the drawn points the pass decoded around each pin.
  it("chimney, Iso and Top: the pin just inside the rim is not occluded by the rim beside it", () => {
    const pin: [number, number, number] = [243514.864, 3178241.331, 187.651];
    const iso: [number, number, number] = [244197.5, 3177605.86, 677.68];
    const top: [number, number, number] = [243537.57, 3178265.68, 1146.53];
    expect(
      isOccluded(
        iso,
        pin,
        [
          [243515.76, 3178239, 186.52],
          [243516.53, 3178240.16, 186.68],
        ],
        0.514,
      ),
    ).toBe(false);
    expect(
      isOccluded(
        top,
        pin,
        [
          [243513.48, 3178241.89, 189.37],
          [243511.71, 3178243.32, 189.18],
        ],
        0.514,
      ),
    ).toBe(false);
  });

  it("chimney, Front: a pin on the far side of the stack stays occluded by the near wall", () => {
    const front: [number, number, number] = [243537.57, 3177126.46, 24.18];
    const near: Array<[number, number, number]> = [
      [243519.47, 3178244, 166.7],
      [243517.18, 3178243.52, 171.2],
      [243515.91, 3178242.33, 173.08],
      [243518.19, 3178244.13, 175.43],
    ];
    expect(isOccluded(front, [243519.493, 3178256.158, 173.836], near, 0.3)).toBe(true);
  });
});
