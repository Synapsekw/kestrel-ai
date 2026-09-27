import { describe, expect, it } from "vitest";
import type { GeoMap } from "@contract/client";
import { exampleGeoMap } from "@/test/fixtures";
import { defaultSiteEpsg, frameSwitchLabel, rememberCrsEpsg, rememberedCrsEpsg } from "./frameSwitchModel";

const map = (id: string, extra: Partial<GeoMap> = {}): GeoMap => ({ ...exampleGeoMap, id, ...extra });
const WGS84_MAP = {
  epsg: 4326,
  crs_wkt: 'GEOGCRS["WGS 84"]',
  proj4: "+proj=longlat +datum=WGS84 +no_defs",
};

describe("frameSwitchLabel", () => {
  it("names the other frame and how many items it shows", () => {
    expect(frameSwitchLabel("crs", { crs: 4, local: 2 })).toBe("Local metres · 2 items");
    expect(frameSwitchLabel("local", { crs: 1, local: 2 })).toBe("Site CRS · 1 item");
  });
});

describe("the last CRS frame's EPSG (session memory)", () => {
  it("is null until a CRS frame was seen, then per project", () => {
    expect(rememberedCrsEpsg("p-mem")).toBeNull();
    rememberCrsEpsg("p-mem", 32633);
    expect(rememberedCrsEpsg("p-mem")).toBe(32633);
    expect(rememberedCrsEpsg("p-other")).toBeNull();
  });
});

describe("defaultSiteEpsg (rule M3 over the maps list)", () => {
  it("takes the oldest ready georeferenced map's projected CRS", () => {
    const maps = [
      map("new", {
        epsg: 32634,
        proj4: "+proj=utm +zone=34 +datum=WGS84 +units=m +no_defs",
        created_at: "2026-09-25T00:00:00Z",
      }),
      map("old", { created_at: "2026-09-20T00:00:00Z" }),
    ];
    expect(defaultSiteEpsg(maps)).toBe(32633);
  });

  it("skips maps that are not ready or have no CRS", () => {
    const maps = [
      map("importing", { status: "importing", epsg: 32634, created_at: "2026-09-01T00:00:00Z" }),
      map("plain", { crs_wkt: null, epsg: null, proj4: null, created_at: "2026-09-02T00:00:00Z" }),
      map("ok", { created_at: "2026-09-03T00:00:00Z" }),
    ];
    expect(defaultSiteEpsg(maps)).toBe(32633);
  });

  it("replaces a geographic CRS by the UTM zone of the map's centre", () => {
    expect(defaultSiteEpsg([map("geo", { ...WGS84_MAP, bounds_wgs84: [15, 44.98, 15.03, 45] })])).toBe(32633);
    expect(defaultSiteEpsg([map("south", { ...WGS84_MAP, bounds_wgs84: [-47, -23, -46.9, -22.9] })])).toBe(
      32723,
    );
  });

  it("is null when nothing is georeferenced, or the chosen CRS has no EPSG code", () => {
    expect(defaultSiteEpsg([])).toBeNull();
    expect(defaultSiteEpsg([map("plain", { crs_wkt: null, epsg: null, proj4: null })])).toBeNull();
    expect(defaultSiteEpsg([map("custom", { epsg: null })])).toBeNull();
  });
});
