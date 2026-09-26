import { describe, expect, it } from "vitest";
import type { GeoMap } from "@contract/client";
import { exampleGeoMap } from "@/test/fixtures";
import { exampleCloud } from "@/test/cloudFixtures";
import { pixelToNative } from "@/maps/coords";
import {
  between,
  cloudToMapNative,
  cloudsForMap,
  footprintDiagonal,
  insideXY,
  jumpQuery,
  mapPixelToCloud,
  nativeToPixel,
  parseAt,
  parseFootprint,
} from "./jump";

const UTM39 = "+proj=utm +zone=39 +datum=WGS84 +units=m +no_defs";
const UTM38 = "+proj=utm +zone=38 +datum=WGS84 +units=m +no_defs";
const map: GeoMap = {
  ...exampleGeoMap,
  id: "m1",
  epsg: 32639,
  proj4: UTM39,
  geotransform: [243500, 0.05, 0.01, 3178100, 0.02, -0.05],
};
const cloud = { ...exampleCloud, epsg: 32639, proj4: UTM39 };

describe("3D jump URLs", () => {
  it("parses and writes at and fp", () => {
    const q = new URLSearchParams("at=243522.5,3178252.25&fp=1,2;3,4;5,6;7,8");
    expect(parseAt(q)).toEqual({ x: 243522.5, y: 3178252.25 });
    expect(parseFootprint(q)).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
      { x: 7, y: 8 },
    ]);
    expect(jumpQuery({ x: 1, y: 2 })).toBe("?at=1.000,2.000");
    expect(
      jumpQuery({ x: 1, y: 2 }, [
        { x: 3, y: 4 },
        { x: 5.5, y: 6 },
      ]),
    ).toBe("?at=1.000,2.000&fp=3.000,4.000;5.500,6.000");
    for (const bad of ["at=", "at=1", "at=a,b", "at=1,2,3"])
      expect(parseAt(new URLSearchParams(bad))).toBeNull();
    expect(parseFootprint(new URLSearchParams("fp=1,2;x,4"))).toBeNull();
  });

  it("inverts an affine with rotation terms", () => {
    const [x, y] = pixelToNative(map.geotransform!, 1234.5, 678.25);
    const [px, py] = nativeToPixel(map.geotransform!, x, y);
    expect(px).toBeCloseTo(1234.5, 6); // UTM magnitudes leave ~1e-9 px of float64 noise
    expect(py).toBeCloseTo(678.25, 6);
  });

  it("is the identity between entities in the same EPSG", () => {
    const [x, y] = pixelToNative(map.geotransform!, 100, 200);
    expect(mapPixelToCloud(map, cloud, 100, 200)).toEqual({ x, y });
  });

  it("round-trips 32639 <-> 32638 within a millimetre", () => {
    const there = between({ proj4: UTM39, epsg: 32639 }, { proj4: UTM38, epsg: 32638 });
    const back = between({ proj4: UTM38, epsg: 32638 }, { proj4: UTM39, epsg: 32639 });
    const p = { x: 243522.123, y: 3178252.456 };
    const q = back(there(p));
    expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThan(0.001);
    const onMap38 = cloudToMapNative(cloud, { ...map, epsg: 32638, proj4: UTM38 }, p);
    expect(Math.abs(onMap38.x - p.x)).toBeGreaterThan(1000); // really another zone
  });

  it("finds the ready clouds linked to a map, newest first, and tests bounds", () => {
    const a = { ...cloud, id: "a", map_id: "m1", created_at: "2026-09-01T00:00:00Z" };
    const b = { ...cloud, id: "b", map_id: "m1", created_at: "2026-09-02T00:00:00Z" };
    const busy = { ...cloud, id: "c", map_id: "m1", status: "importing" as const };
    const other = { ...cloud, id: "d", map_id: "m2" };
    expect(cloudsForMap([a, busy, other, b], "m1").map((c) => c.id)).toEqual(["b", "a"]);
    expect(insideXY([0, 0, 0, 10, 10, 10], { x: 5, y: 5 })).toBe(true);
    expect(insideXY([0, 0, 0, 10, 10, 10], { x: 11, y: 5 })).toBe(false);
    expect(
      footprintDiagonal([
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 4 },
        { x: 0, y: 4 },
      ]),
    ).toBe(5);
  });
});
