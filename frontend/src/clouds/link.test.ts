import { describe, expect, it } from "vitest";
import type { GeoMap } from "@contract/client";
import { exampleGeoMap } from "@/test/fixtures";
import { exampleCloud } from "@/test/cloudFixtures";
import { rankMaps } from "./link";

const cloud = { ...exampleCloud, bounds_wgs84: [48.0, 28.0, 48.1, 28.1], captured_on: "2026-05-04" };
const map = (id: string, b: number[] | null, extra: Partial<GeoMap> = {}): GeoMap => ({
  ...exampleGeoMap,
  id,
  name: id,
  bounds_wgs84: b,
  captured_on: "2026-05-04",
  ...extra,
});

describe("map link ranking", () => {
  it("ranks by overlap and flags the likely same flight", () => {
    const ranked = rankMaps(cloud, [
      map("quarter", [48.05, 28.05, 48.2, 28.2]),
      map("full", [47.9, 27.9, 48.2, 28.2]),
      map("other-day", [47.9, 27.9, 48.2, 28.2], { captured_on: "2026-06-01" }),
    ]);
    expect(ranked.map((r) => r.map.id)).toEqual(["full", "other-day", "quarter"]);
    expect(ranked[0].overlap).toBeCloseTo(1, 6);
    expect(ranked[0].likelySameFlight).toBe(true);
    expect(ranked[1].likelySameFlight).toBe(false);
    expect(ranked[2].overlap).toBeCloseTo(0.25, 6);
    expect(ranked[2].likelySameFlight).toBe(false);
  });

  it("leaves out maps that cannot be linked", () => {
    expect(
      rankMaps(cloud, [
        map("apart", [10, 10, 11, 11]),
        map("no-crs", [48, 28, 48.1, 28.1], { crs_wkt: null }),
        map("importing", [48, 28, 48.1, 28.1], { status: "importing" }),
        map("no-bounds", null),
      ]),
    ).toEqual([]);
    expect(rankMaps({ ...cloud, bounds_wgs84: null }, [map("full", [47.9, 27.9, 48.2, 28.2])])).toEqual([]);
  });
});
