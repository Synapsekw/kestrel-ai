import { describe, expect, it } from "vitest";
import { baseMapRows } from "../layers/rasterRows";
import { AUG, SEP, mapLayer, surfaceLayer } from "../test/rasterFixtures";
import { pickMinimapRow, siteExtentOf, viewportRing } from "./minimapModel";

describe("minimap model", () => {
  const rows = baseMapRows({
    layers: [mapLayer("aug", AUG), mapLayer("sep", SEP)],
  });

  it("uses r's ortho, else the topmost ortho, skipping gone ones", () => {
    expect(pickMinimapRow(rows, undefined, AUG, new Set())?.id).toBe("aug");
    expect(pickMinimapRow(rows, undefined, "2020-01-01", new Set())?.id).toBe("sep");
    expect(pickMinimapRow(rows, undefined, AUG, new Set(["map:aug"]))?.id).toBe("sep");
    expect(pickMinimapRow([], undefined, AUG, new Set())).toBeNull();
  });

  it("follows the operator's order for the fallback", () => {
    expect(pickMinimapRow(rows, ["map:aug", "map:sep"], null, new Set())?.id).toBe("aug");
  });

  it("fits the union of in-frame map and surface footprints", () => {
    const a = mapLayer("a", AUG, { footprint_site: [0, 0, 10, 10] });
    const b = surfaceLayer("b", SEP, "cloud_dsm", {
      footprint_site: [5, -5, 20, 8],
    });
    const out = mapLayer("d", AUG, { in_frame: false, footprint_site: [-99, -99, 999, 999] });
    expect(siteExtentOf([a, b, out, mapLayer("c", null, { footprint_site: null })])).toEqual([0, -5, 20, 10]);
    expect(siteExtentOf([])).toBeNull();
  });

  it("draws the viewport as a closed, rotated ring", () => {
    expect(viewportRing({ center: [100, 50], resolution: 0.5, rotation: 0 }, [400, 200])).toEqual([
      [0, 0],
      [200, 0],
      [200, 100],
      [0, 100],
      [0, 0],
    ]);
    const r = viewportRing({ center: [0, 0], resolution: 1, rotation: Math.PI / 2 }, [4, 2]);
    expect(r[0].map((v) => Math.round(v))).toEqual([1, -2]);
  });
});
