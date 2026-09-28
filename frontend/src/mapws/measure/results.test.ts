import { describe, expect, it } from "vitest";
import { DSM_AUG, measurement } from "@/mapws/test/w3Fixtures";
import {
  areaView,
  crsText,
  distanceView,
  headline,
  isLocal,
  profileView,
  resultsOf,
  siteCoords,
  vertexCount,
} from "./results";

const local = { epsg: null, crs_wkt: null };

describe("measurement results", () => {
  it("a distance leads with the ellipsoidal length, then grid and scale factor", () => {
    expect(distanceView(measurement("distance"))).toEqual({
      length: 50.02,
      basis: "ellipsoidal",
      grid: 50,
      scale: 0.99962,
      length3d: 50.31,
      nodata: 0,
    });
  });

  it("a local distance shows the grid length only", () => {
    const m = measurement("distance", {
      ...local,
      results: {
        length_m: null,
        grid_length_m: 50,
        scale_factor: null,
        length_3d_m: null,
        nodata_fraction: null,
        dsm_surface_id: null,
      },
    });
    expect(isLocal(m)).toBe(true);
    expect(crsText(m)).toBe("Local metres");
    expect(distanceView(m)).toEqual({
      length: 50,
      basis: "local",
      grid: null,
      scale: null,
      length3d: null,
      nodata: null,
    });
  });

  it("an area gives area, perimeter, grid area and the areal scale factor; local gives grid values", () => {
    expect(areaView(measurement("area"))).toEqual({
      area: 1000752.4,
      basis: "ellipsoidal",
      perimeter: 4001.5,
      grid: 1000000,
      scale: 0.99925,
    });
    const m = measurement("area", {
      ...local,
      results: {
        area_m2: null,
        perimeter_m: null,
        grid_area_m2: 1000000,
        grid_perimeter_m: 4000,
        areal_scale_factor: null,
      },
    });
    expect(areaView(m)).toEqual({
      area: 1000000,
      basis: "local",
      perimeter: 4000,
      grid: null,
      scale: null,
    });
    expect(vertexCount(measurement("area"))).toBe(4);
    expect(siteCoords(measurement("area"))).toHaveLength(4);
  });

  it("site coordinates come from vertices_site only, never the stored frame (P6)", () => {
    const stored = measurement("distance", { vertices_site: undefined });
    expect(siteCoords(stored)).toEqual([]);
    expect(vertexCount(stored)).toBe(0);
  });

  it("results are narrowed on the kind, not on which keys are present (P7)", () => {
    const d = resultsOf(measurement("distance"));
    expect(d.kind).toBe("distance");
    if (d.kind === "distance") expect(d.results.grid_length_m).toBe(50);
    const p = resultsOf(measurement("profile"));
    expect(p.kind).toBe("profile");
    if (p.kind === "profile") expect(p.results.stations_m).toHaveLength(6);
    // A view asked for another kind's numbers answers nothing rather than guessing.
    expect(distanceView(measurement("area")).length).toBeNull();
  });

  it("a profile keeps null heights as gaps and drops malformed series", () => {
    const v = profileView(measurement("profile"));
    expect(v.hasData).toBe(true);
    expect(v.stations).toEqual([0, 10, 20, 30, 40, 50]);
    expect(v.series[0].surfaceId).toBe(DSM_AUG);
    expect(v.series[0].z[3]).toBeNull();
    expect(v).toMatchObject({
      zMin: 600,
      zMax: 606,
      cut: 10,
      fill: 40,
      nodata: 0.1,
    });
    const broken = measurement("profile", {
      results: { stations_m: [0, 1], series: [null, { label: "x" }] },
    });
    expect(profileView(broken).series).toEqual([]);
    expect(profileView(broken).hasData).toBe(false);
  });

  it("a listed profile row (no stations, no series) is 'no profile data yet', not data", () => {
    const listed = measurement("profile", {
      results: {
        length_m: 50.02,
        grid_length_m: 50,
        stations_m: [],
        series: [],
        z_min: 600,
        z_max: 606,
        cut_area_m2: 10,
        fill_area_m2: 40,
        nodata_fraction: 0.1,
      },
    });
    const v = profileView(listed);
    expect(v.hasData).toBe(false);
    expect(v.stations).toEqual([]);
    expect(v.series).toEqual([]);
    // A13: the headline reads the stored length, not the last station.
    expect(headline(listed)).toBe("Profile · 50.02 m");
  });

  it("headlines and the CRS", () => {
    expect(headline(measurement("distance"))).toBe("50.02 m");
    expect(headline(measurement("area"))).toBe("1 000 752 m²");
    expect(headline(measurement("profile"))).toBe("Profile · 50.02 m");
    const localProfile = measurement("profile", {
      ...local,
      results: { ...resultsOf(measurement("profile")).results, length_m: null },
    });
    expect(headline(localProfile)).toBe("Profile · 50.00 m");
    expect(crsText(measurement("distance"))).toBe("EPSG:32638");
  });
});
