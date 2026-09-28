import { describe, expect, it } from "vitest";
import {
  between,
  extentOf,
  fitView,
  gridStep,
  nearestPoint,
  rasterise,
  toData,
  toPx,
  toWorld,
  zoomAt,
  type ProfileData,
} from "./profileView";
import { lineKey, slabBox, zRangeOf } from "./slab";

const data = (s: number[], z: number[], rgb: number[] | null = null): ProfileData => ({
  s,
  z,
  rgb,
  count: s.length,
});

describe("profile view maths", () => {
  it("fits the extent inside the padding, 1:1 when asked", () => {
    const e = extentOf(data([0, 10], [0, 5]))!;
    const v = fitView(e, 220, 120, true);
    expect(v.sx).toBe(v.sz);
    expect(toPx(v, { s: 0, z: 0 })).toEqual({ x: 22, y: 104 });
    expect(toPx(v, { s: 10, z: 5 })).toEqual({ x: 198, y: 16 });
    const free = fitView(e, 220, 120, false);
    expect(free.sx).toBeCloseTo(18.8, 12);
    expect(free.sz).toBeCloseTo(17.6, 12);
  });

  it("has no extent without points", () => {
    expect(extentOf(data([], []))).toBeNull();
  });

  it("maps pixels back to data and zooms about the cursor", () => {
    const v = { sx: 12, sz: 8, ox: 30, oz: 200 };
    expect(toData(v, toPx(v, { s: 3.5, z: -2 }).x, toPx(v, { s: 3.5, z: -2 }).y)).toEqual({ s: 3.5, z: -2 });
    const z = zoomAt(v, 90, 60, 2);
    expect(toData(z, 90, 60)).toEqual(toData(v, 90, 60));
    expect(z.sx).toBe(24);
  });

  it("picks a metre-grid step at least 40 px apart", () => {
    expect(gridStep(100)).toBe(0.5);
    expect(gridStep(3)).toBe(20);
    expect(gridStep(40)).toBe(1);
  });

  it("rasterises points as 2 x 2 dots in their colour, skipping what is off the canvas", () => {
    const buf = new Uint8ClampedArray(10 * 10 * 4);
    const v = { sx: 1, sz: 1, ox: 0, oz: 9 };
    const drawn = rasterise(buf, 10, 10, v, data([2, 20], [3, 3], [200, 100, 50, 1, 1, 1]), [9, 9, 9]);
    expect(drawn).toBe(1);
    const k = 4 * (6 * 10 + 2);
    expect([...buf.slice(k, k + 4)]).toEqual([200, 100, 50, 255]);
    expect([...buf.slice(k + 4, k + 8)]).toEqual([200, 100, 50, 255]);
    rasterise(buf, 10, 10, v, data([2], [3]), [9, 9, 9]);
    expect([...buf.slice(k, k + 4)]).toEqual([9, 9, 9, 255]);
  });

  it("snaps a click to the nearest profile point within 8 px", () => {
    const v = { sx: 10, sz: 10, ox: 0, oz: 100 };
    const d = data([0, 5], [0, 0]);
    expect(nearestPoint(d, v, 53, 102)).toEqual({ s: 5, z: 0 });
    expect(nearestPoint(d, v, 80, 100)).toBeNull();
  });

  it("measures between two profile points", () => {
    expect(between({ s: 1, z: 2 }, { s: 4, z: 6 })).toEqual({ d: 5, ds: 3, dz: 4 });
  });

  it("turns a profile point into a 3D point on the line at UTM magnitudes", () => {
    const line = {
      a: { x: 553100.25, y: 4983000.5, z: 12, uncertainty_m: 0.02 },
      b: { x: 553110.25, y: 4983000.5, z: 12, uncertainty_m: 0.02 },
    };
    expect(toWorld(line, { s: 3, z: 40 }, 0.2)).toEqual({
      x: 553103.25,
      y: 4983000.5,
      z: 40,
      uncertainty_m: 0.1,
    });
  });
});

describe("slab helpers", () => {
  const a = { x: 0, y: 0, z: 5, uncertainty_m: 0 };
  const b = { x: 0, y: 10, z: 5, uncertainty_m: 0 };

  it("builds the slab box along the line's bearing, over the cloud's height", () => {
    expect(slabBox({ a, b, thicknessM: 0.2 }, [-45, 175])).toEqual({
      centre: [0, 5, 65],
      size: [10, 0.2, 222],
      yawDeg: 90,
    });
  });

  it("keys a line by its ends and thickness", () => {
    expect(lineKey({ a, b, thicknessM: 0.2 })).toBe(lineKey({ a: { ...a }, b: { ...b }, thicknessM: 0.2 }));
    expect(lineKey({ a, b, thicknessM: 0.2 })).not.toBe(lineKey({ a, b, thicknessM: 0.5 }));
  });

  it("reads the cloud's Z range from its bounds", () => {
    expect(zRangeOf({ bounds_native: [0, 0, -45, 1, 1, 175] })).toEqual([-45, 175]);
    expect(zRangeOf({ bounds_native: null })).toEqual([-10000, 10000]);
  });
});
