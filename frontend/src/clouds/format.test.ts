import { describe, expect, it } from "vitest";
import { exampleCloud } from "@/test/cloudFixtures";
import { crsLabel, crsName, formatBytes, formatPoints, heightsLabel } from "./format";

describe("cloud formatting", () => {
  it("formats point counts and sizes the way the list shows them", () => {
    expect(formatPoints(21_697_184)).toBe("21.7 M points");
    expect(formatPoints(195_274_656)).toBe("195.3 M points");
    expect(formatPoints(50_000)).toBe("50 000 points");
    expect(formatBytes(737_902_645)).toBe("738 MB");
    expect(formatBytes(6_200_000_000)).toBe("6.2 GB");
    expect(formatBytes(900_000)).toBe("0.9 MB");
  });

  it("labels the CRS and the heights", () => {
    expect(crsLabel(exampleCloud)).toBe("EPSG:32639");
    expect(crsLabel({ ...exampleCloud, epsg: null, crs_wkt: null })).toBe("no coordinates");
    expect(crsLabel({ ...exampleCloud, epsg: null })).toBe("custom CRS");
    expect(heightsLabel(exampleCloud)).toBe("as stored, no vertical datum");
    expect(crsName('PROJCRS["WGS 84 / UTM zone 39N",BASEGEOGCRS["WGS 84"]]')).toBe("WGS 84 / UTM zone 39N");
    expect(crsName(null)).toBeNull();
    expect(heightsLabel({ ...exampleCloud, vertical_crs: "EGM96 height" })).toBe("EGM96 height");
  });
});
