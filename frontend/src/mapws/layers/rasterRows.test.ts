import { describe, expect, it } from "vitest";
import { layer } from "../test/fixtures";
import { AUG, SEP, mapLayer, surfaceLayer } from "../test/rasterFixtures";
import { baseMapRows, elevationRows, surfaceKindOf } from "./rasterRows";

const layers = [
  mapLayer("aug", AUG),
  mapLayer("sep", SEP),
  mapLayer("old", "2026-06-01"),
  surfaceLayer("dsm", SEP),
  surfaceLayer("dem", AUG, "dem"),
  surfaceLayer("design", null, "design"),
  layer("drawing", "plan"),
];

describe("W2 layer rows (M §5.2, ruling W2-4)", () => {
  it("lists orthos newest first as 'Orthomosaic · date' with the file name in the meta line", () => {
    const rows = baseMapRows({ layers });
    expect(rows.map((r) => r.key)).toEqual(["map:sep", "map:aug", "map:old"]);
    expect(rows[0]).toMatchObject({
      kind: "map",
      group: "base",
      name: "Orthomosaic · 14 Sep 2026",
      meta: "sep.tif · 3.0 cm · 2.4 GB",
      date: SEP,
      version: "1",
    });
    expect(rows[0].layer?.id).toBe("sep");
  });

  it("an import-date ortho reads 'date not set' but stays placed on its import date", () => {
    const [row] = baseMapRows({
      layers: [mapLayer("x", AUG, { date_is_import_date: true })],
    });
    expect(row.name).toBe("Orthomosaic · date not set");
    expect(row.date).toBe(AUG);
  });

  it("lists designs on top, then surfaces newest first, with role badges", () => {
    const rows = elevationRows({ layers });
    expect(rows.map((r) => r.key)).toEqual([
      "surface:design",
      "surface:dsm",
      "surface:dem",
    ]);
    expect(rows.map((r) => r.badge)).toEqual(["Design", "DSM", "DTM"]);
    expect(rows[0]).toMatchObject({
      group: "elevation",
      date: null,
      meta: "from Site plan rev C",
    });
  });

  it("reads the surface kind from the M-C0 row, null when absent", () => {
    expect(surfaceKindOf(surfaceLayer("d", null, "dem"))).toBe("dem");
    expect(surfaceKindOf(layer("surface", "x"))).toBeNull();
  });

  it("drops rows for layers not in this frame (recon §1 T3)", () => {
    const rows = baseMapRows({
      layers: [mapLayer("out", AUG, { in_frame: false })],
    });
    expect(rows).toHaveLength(0);
    const elevRows = elevationRows({
      layers: [surfaceLayer("out", AUG, "dem", { in_frame: false })],
    });
    expect(elevRows).toHaveLength(0);
  });
});
