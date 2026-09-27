import { describe, expect, it } from "vitest";
import { cropKey, inside, viewportCrop } from "./crop";

const image = { width: 4000, height: 3000 };

describe("viewportCrop", () => {
  it("maps the visible rectangle to image px and snaps outward to 64", () => {
    // scale 1, panned so image px 1000..1900 × 700..1400 are visible
    const c = viewportCrop({ scale: 1, x: -1000, y: -700 }, { width: 900, height: 700 }, image)!;
    expect(c).toEqual({ x: 960, y: 640, w: 960, h: 768 });
    expect(c.x % 64).toBe(0);
    expect(c.w % 64).toBe(0);
  });
  it("grows a zoomed-in view to at least 512 px around its centre", () => {
    const c = viewportCrop({ scale: 8, x: -8000, y: -8000 }, { width: 800, height: 800 }, image)!;
    expect(c.w).toBeGreaterThanOrEqual(512);
    expect(c.h).toBeGreaterThanOrEqual(512);
    expect(c.x).toBeLessThanOrEqual(1000);
    expect(c.x + c.w).toBeGreaterThanOrEqual(1100);
  });
  it("clips to the image and never exceeds it", () => {
    const c = viewportCrop({ scale: 0.2, x: 0, y: 0 }, { width: 1200, height: 900 }, image)!;
    expect(c).toEqual({ x: 0, y: 0, w: 4000, h: 3000 });
  });
  it("handles an image smaller than 512 and an off-image view", () => {
    expect(
      viewportCrop({ scale: 1, x: 0, y: 0 }, { width: 800, height: 600 }, { width: 300, height: 200 }),
    ).toEqual({ x: 0, y: 0, w: 300, h: 200 });
    expect(viewportCrop({ scale: 1, x: 10000, y: 0 }, { width: 800, height: 600 }, image)).toBeNull();
    expect(viewportCrop({ scale: 1, x: 0, y: 0 }, { width: 0, height: 0 }, image)).toBeNull();
  });
  it("keys and contains", () => {
    const c = { x: 0, y: 0, w: 512, h: 512 };
    expect(cropKey(c)).toBe("0,0,512,512");
    expect(inside(c, { x: 511.9, y: 0 })).toBe(true);
    expect(inside(c, { x: 512.1, y: 0 })).toBe(false);
  });
});
