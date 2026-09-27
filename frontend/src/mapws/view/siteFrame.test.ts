import { describe, expect, it } from "vitest";
import { LOCAL, UTM33 } from "../test/fixtures";
import {
  fillTile,
  fromWgs84,
  siteCode,
  siteProjection,
  siteTileGrid,
  siteTileUrl,
  toWgs84,
  viewResolutions,
  zoomPercent,
} from "./siteFrame";
import { tileAt } from "./siteGrid";

describe("site frame", () => {
  it("registers the site CRS with OpenLayers through proj4", () => {
    const p = siteProjection(UTM33);
    expect(p.getCode()).toBe("EPSG:32633");
    expect(p.getUnits()).toBe("m");
    expect(siteCode(UTM33)).toBe("EPSG:32633");
  });

  it("gives a CRS without an EPSG code a stable code of its own", () => {
    const custom = { ...UTM33, epsg: null };
    expect(siteCode(custom)).toMatch(/^kestrel-site-[0-9a-z]+$/);
    expect(siteCode(custom)).toBe(siteCode({ ...custom }));
    expect(siteProjection(custom).getCode()).toBe(siteCode(custom));
  });

  it("uses a plain metre projection for the local frame", () => {
    expect(siteProjection(LOCAL).getCode()).toBe("kestrel-local");
    expect(siteProjection(LOCAL).getUnits()).toBe("m");
    expect(toWgs84(LOCAL)).toBeNull();
    expect(fromWgs84(LOCAL)).toBeNull();
  });

  it("refuses a CRS frame with no proj4 definition", () => {
    expect(() => siteProjection({ ...UTM33, proj4: null })).toThrow(/proj4/);
  });

  it("builds OpenLayers' tile grid on the same rows and columns as siteGrid", () => {
    const grid = siteTileGrid();
    for (const [e, n, z] of [
      [500123.45, 4981234.5, 10],
      [500123.45, 4981234.5, 17],
      [-10.5, 3.25, 10],
      [-10.5, -3.25, 10],
    ] as const) {
      const t = tileAt(e, n, z);
      expect(grid.getTileCoordForCoordAndZ([e, n], z)).toEqual([z, t.x, t.y]);
    }
    expect(siteTileGrid(17).getMaxZoom()).toBe(17);
  });

  it("lets the view overzoom three steps past z 20", () => {
    const r = viewResolutions();
    expect(r).toHaveLength(24);
    expect(r[21]).toBe(r[20] / 2);
  });

  it("fills M-C0's site tile URL template", () => {
    const url = siteTileUrl("http://127.0.0.1:8765/", "tok", "p1", "surface", "s1", "3", {
      style: "hillshade",
    });
    const filled = new URL(fillTile(url, [12, -3, 40]));
    expect(filled.pathname).toBe("/api/v1/projects/p1/site-tiles/surface/s1/12/-3/40");
    expect(Object.fromEntries(filled.searchParams)).toEqual({
      token: "tok",
      v: "3",
      style: "hillshade",
    });
  });

  it("converts between WGS84 and the site CRS", () => {
    const [e, n] = fromWgs84(UTM33)!([15.0, 45.0]);
    expect(e).toBeCloseTo(500000, 3);
    // 0.9996 × the meridian arc to 45° (4 984 944 m) ≈ 4 982 950 m.
    expect(n).toBeGreaterThan(4982900);
    expect(n).toBeLessThan(4983000);
    const [lon, lat] = toWgs84(UTM33)!([e, n]);
    expect(lon).toBeCloseTo(15.0, 9);
    expect(lat).toBeCloseTo(45.0, 9);
  });

  it("reads the zoom as a percentage of the ortho's ground pixel", () => {
    expect(zoomPercent(0.03, 0.03)).toBe(100);
    expect(zoomPercent(0.06, 0.03)).toBe(50);
    expect(zoomPercent(0.06, null)).toBeNull();
  });
});
