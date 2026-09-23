import { describe, expect, it } from "vitest";
import proj4 from "proj4";
import { exampleGeoMap } from "@/test/fixtures";
import { pixelToNative } from "./coords";
import { areaToPixels, wgs84ToPixel } from "./siteAreaLayer";

const toWgs84 = (px: number, py: number): [number, number] => {
  const [x, y] = pixelToNative(exampleGeoMap.geotransform!, px, py);
  return proj4(exampleGeoMap.proj4!, "EPSG:4326").forward([x, y]) as [number, number];
};

describe("wgs84ToPixel", () => {
  it("inverts the map's georeference", () => {
    const project = wgs84ToPixel(exampleGeoMap)!;
    const [px, py] = project(...toWgs84(1234, 5678));
    expect(px).toBeCloseTo(1234, 3);
    expect(py).toBeCloseTo(5678, 3);
  });

  it("handles a rotated geotransform", () => {
    const rotated = { ...exampleGeoMap, geotransform: [500000, 0.026, 0.015, 4983000, 0.015, -0.026] };
    const [x, y] = pixelToNative(rotated.geotransform, 300, 400);
    const [lon, lat] = proj4(rotated.proj4!, "EPSG:4326").forward([x, y]) as [number, number];
    const [px, py] = wgs84ToPixel(rotated)!(lon, lat);
    expect(px).toBeCloseTo(300, 3);
    expect(py).toBeCloseTo(400, 3);
  });

  it("is null for a map without a georeference", () => {
    expect(wgs84ToPixel({ ...exampleGeoMap, proj4: null })).toBeNull();
    expect(wgs84ToPixel({ ...exampleGeoMap, geotransform: null })).toBeNull();
  });
});

describe("areaToPixels", () => {
  it("projects every vertex of a site area onto the map", () => {
    const ring = [toWgs84(10, 20), toWgs84(110, 20), toWgs84(110, 220)];
    const px = areaToPixels(exampleGeoMap, ring)!;
    expect(px).toHaveLength(3);
    expect(px[2][0]).toBeCloseTo(110, 3);
    expect(px[2][1]).toBeCloseTo(220, 3);
  });
});
