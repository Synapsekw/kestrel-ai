import { afterEach, describe, expect, it } from "vitest";
import { layer } from "@/mapws/test/fixtures";
import { exampleSurface } from "@/test/volumeFixtures";
import { heatmapTileUrl, sameFrame, topLayerFor, volumeSelection, volumeToolDisabled } from "./volumeModel";
import { useVolumeStore } from "./volumeStore";

const DATE = "2026-09-14";
const dsm = layer("surface", "dsm", { date: DATE, surface_kind: "cloud_dsm" });
const dem = layer("surface", "dem", {
  date: DATE,
  surface_kind: "dem",
  elevation_role: "dsm",
});
const dtm = layer("surface", "dtm", {
  date: DATE,
  surface_kind: "dem",
  elevation_role: "dtm",
});
const design = layer("surface", "des", { date: DATE, surface_kind: "design" });
const ortho = layer("map", "map", { date: DATE, surface_kind: null });

describe("top surface of the r date (from the workspace layers)", () => {
  it("prefers the cloud DSM, then an imported DSM; never a DTM, a design or a map", () => {
    expect(topLayerFor([dem, dsm, dtm, design, ortho], DATE)?.id).toBe("dsm");
    expect(topLayerFor([dem, dtm, design], DATE)?.id).toBe("dem");
    expect(topLayerFor([dtm, design, ortho], DATE)).toBeNull();
    expect(topLayerFor([{ ...dsm, in_frame: false }], DATE)).toBeNull();
    expect(topLayerFor([{ ...dsm, status: "importing" }], DATE)).toBeNull();
  });

  it("disables the tool with the spec's hint", () => {
    expect(volumeToolDisabled([dtm], DATE)).toBe(
      "No DSM for 14 Sep 2026 — import one or build it from a point cloud",
    );
    expect(volumeToolDisabled([], null)).toBe("Choose a survey date first");
    expect(volumeToolDisabled([dsm], DATE)).toBeNull();
  });
});

describe("sameFrame", () => {
  const crs = (epsg: number) => ({
    kind: "crs" as const,
    epsg,
    crs_wkt: "X",
    proj4: "+proj=utm",
    name: "UTM",
  });
  it("is true only when the surface is in the site CRS (or both local)", () => {
    expect(sameFrame(crs(32639), exampleSurface)).toBe(true);
    expect(sameFrame(crs(32638), exampleSurface)).toBe(false);
    const local = {
      kind: "local" as const,
      epsg: null,
      crs_wkt: null,
      proj4: null,
      name: "Local metres",
    };
    expect(sameFrame(local, { epsg: null, crs_wkt: null })).toBe(true);
    expect(sameFrame(local, exampleSurface)).toBe(false);
    expect(sameFrame(null, exampleSurface)).toBe(false);
  });
});

describe("heatmap and selection", () => {
  it("uses the volume_diff site tiles keyed by the calculation time", () => {
    const url = heatmapTileUrl("http://h/", "t", "p1", "v1", "2026-09-24T10:00:00Z");
    expect(url).toContain("/api/v1/projects/p1/site-tiles/volume_diff/v1/");
    expect(decodeURIComponent(url)).toContain("v=2026-09-24T10:00:00Z");
    expect(volumeSelection("v1")).toEqual({ kind: "volume", id: "v1" });
  });
});

describe("volume store", () => {
  afterEach(() => localStorage.clear());
  it("remembers auto-recalculate per viewer", () => {
    useVolumeStore.getState().setAutoRecalc(false);
    expect(localStorage.getItem("kestrel.mapws.autoRecalc")).toBe("0");
    expect(useVolumeStore.getState().autoRecalc).toBe(false);
  });
});
