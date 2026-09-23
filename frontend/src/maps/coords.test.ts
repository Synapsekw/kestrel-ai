import { describe, expect, it } from "vitest";
import { exampleGeoMap } from "@/test/fixtures";
import { formatLonLat, formatNative, makeReadout, pixelToNative } from "./coords";

describe("coordinates", () => {
  it("applies the full geotransform, rotation terms included", () => {
    expect(pixelToNative([500000, 0.03, 0, 4983000, 0, -0.03], 100, 200)).toEqual([500003, 4982994]);
    const [x, y] = pixelToNative([0, 1, 0.5, 0, 0.25, -1], 10, 10);
    expect([x, y]).toEqual([15, -7.5]);
  });

  it("formats hemispheres and projected coordinates", () => {
    expect(formatLonLat(15.0001234, 44.9876543)).toBe("44.987654° N, 15.000123° E");
    expect(formatLonLat(-3.5, -12.25)).toBe("12.250000° S, 3.500000° W");
    expect(formatNative(500003.457, 4982994.1, 32633)).toBe("500003.46, 4982994.10 · EPSG:32633");
  });

  it("reads out pixel, native and WGS84 for a UTM map", () => {
    const readout = makeReadout(exampleGeoMap)(1000, 2000);
    expect(readout.pixel).toBe("1000, 2000 px");
    expect(readout.native).toBe("500030.00, 4982940.00 · EPSG:32633");
    // northing 4982940 m on the 15° E meridian is about 44.9999° N (45° N is at about 4982950 m)
    expect(readout.wgs84).toMatch(/^44\.99\d{4}° N, 15\.000\d{3}° E$/);
  });

  it("reads out pixels only when the map has no coordinates", () => {
    const readout = makeReadout({ ...exampleGeoMap, geotransform: null, proj4: null, epsg: null })(5, 6);
    expect(readout).toEqual({ pixel: "5, 6 px", native: null, wgs84: null });
  });
});
