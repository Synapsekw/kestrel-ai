import { Matrix4, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import { exampleGeoMap } from "@/test/fixtures";
import { exampleCloud } from "@/test/cloudFixtures";
import {
  fromMini,
  horizontalFov,
  imageMatrix,
  miniFrame,
  toMini,
  underlayCorners,
  viewCone,
} from "./minimap";

const B = [1000, 2000, 0, 1400, 2200, 50] as [number, number, number, number, number, number];

describe("minimap geometry (spec §6, C11)", () => {
  it("fits the cloud's XY box, north up, and inverts exactly", () => {
    const f = miniFrame(B, 330, 178, 12);
    const [x0, y0] = toMini(f, 1000, 2200); // north-west corner = top-left
    const [x1, y1] = toMini(f, 1400, 2000); // south-east corner = bottom-right
    expect(x0).toBeLessThan(x1);
    expect(y0).toBeLessThan(y1);
    expect(Math.min(x0, y0)).toBeGreaterThanOrEqual(12 - 1e-9);
    expect(x1).toBeLessThanOrEqual(330 - 12 + 1e-9);
    expect(y1).toBeLessThanOrEqual(178 - 12 + 1e-9);
    const [x, y] = fromMini(f, ...toMini(f, 1234.5, 2111.25));
    expect(x).toBeCloseTo(1234.5, 9);
    expect(y).toBeCloseTo(2111.25, 9);
  });

  it("places a unit image by three corners", () => {
    expect(imageMatrix([10, 20], [110, 20], [10, 70])).toBe("matrix(100 0 0 50 10 20)");
  });

  it("transforms a linked map's corners into the cloud's CRS", () => {
    const map = {
      ...exampleGeoMap,
      proj4: exampleCloud.proj4,
      epsg: exampleCloud.epsg,
      geotransform: [243200, 0.5, 0, 3178600, 0, -0.5],
      width: 1000,
      height: 800,
    };
    const c = underlayCorners(map, exampleCloud);
    expect(c).not.toBeNull();
    expect(c![0]).toEqual([243200, 3178600]);
    expect(c![1]).toEqual([243700, 3178600]);
    expect(c![2]).toEqual([243200, 3178200]);
    expect(underlayCorners({ ...map, geotransform: null }, exampleCloud)).toBeNull();
  });

  it("reads the horizontal field of view from any view-projection matrix", () => {
    const cam = new PerspectiveCamera(60, 2, 0.1, 5000);
    cam.up.set(0, 0, 1);
    cam.position.set(10, 20, 30);
    cam.lookAt(50, 80, 0);
    cam.updateMatrixWorld();
    const vp = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const expected = 2 * Math.atan(Math.tan(Math.PI / 6) * 2);
    expect(horizontalFov(vp.elements)).toBeCloseTo(expected, 6);
  });

  it("draws a 70 px cone along the view's horizontal direction, none when looking straight down", () => {
    const f = miniFrame(B, 330, 178, 12);
    const pts = viewCone([1200, 2100], [0, 1, -0.2], Math.PI / 2, f)!;
    const [apex, left, right] = pts.split(" ").map((p) => p.split(",").map(Number));
    expect(apex).toEqual(toMini(f, 1200, 2100).map((v) => Number(v.toFixed(1))));
    expect(Math.hypot(left[0] - apex[0], left[1] - apex[1])).toBeCloseTo(70, 0);
    expect((left[1] + right[1]) / 2).toBeLessThan(apex[1]); // north is up on the minimap
    expect(viewCone([1200, 2100], [0, 0, -1], 1, f)).toBeNull();
  });
});
