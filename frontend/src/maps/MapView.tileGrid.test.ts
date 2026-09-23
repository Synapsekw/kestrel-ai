import { describe, expect, it } from "vitest";
import { exampleGeoMap } from "@/test/fixtures";
import { toOl } from "./grid";
import { makeTileGrid } from "./MapView";

/**
 * `ol/tilegrid/TileGrid` is pure geometry: it needs no canvas, so this runs in jsdom. It builds the
 * exact same grid `MapView` hands its `TileImage` source (via the shared `makeTileGrid` helper) and
 * checks it against the one convention the backend actually serves: tile y = 0 at the top of the
 * map, increasing downward, and z = max_zoom at full resolution. A flipped y axis or an inverted
 * zoom direction would silently show gapped or offset tile rows; this pins the numbers so that
 * regresses loudly instead.
 */
describe("MapView tile grid", () => {
  const grid = makeTileGrid(exampleGeoMap);
  const maxZ = exampleGeoMap.tile_grid.max_zoom;

  it("puts the map's top-left corner at tile [maxZoom, 0, 0]", () => {
    // (0, 0) sits exactly on the tile grid's own corner boundary; nudge one pixel inside the extent.
    expect(grid.getTileCoordForCoordAndZ(toOl(1, 1), maxZ)).toEqual([maxZ, 0, 0]);
  });

  it("resolves one tile down from the top-left to tile row 1, not -1", () => {
    expect(grid.getTileCoordForCoordAndZ(toOl(0, 256), maxZ)).toEqual([maxZ, 0, 1]);
  });

  it("resolves one tile right from the top-left to tile column 1", () => {
    expect(grid.getTileCoordForCoordAndZ(toOl(256, 0), maxZ)).toEqual([maxZ, 1, 0]);
  });

  it("halves tile coordinates one zoom level below full resolution", () => {
    expect(grid.getTileCoordForCoordAndZ(toOl(512, 512), maxZ - 1)).toEqual([maxZ - 1, 1, 1]);
  });
});
