import { describe, expect, it } from "vitest";
import { MAX_GROUND_TILES, groundTiles, toAssetXZ } from "./ground";

const origin = { lat: 25.2, lon: 55.3, ground_alt_m: 4 };

describe("ground tiles", () => {
  it("puts true north on +X when plant north is true north", () => {
    const [x, z] = toAssetXZ(origin.lat + 0.001, origin.lon, origin, 0);
    expect(x).toBeCloseTo(111.32, 1);
    expect(z).toBeCloseTo(0, 6);
    const [ex, ez] = toAssetXZ(origin.lat, origin.lon + 0.001, origin, 0);
    expect(ex).toBeCloseTo(0, 6);
    expect(ez).toBeCloseTo(111.32 * Math.cos((25.2 * Math.PI) / 180), 1);
  });

  it("turns the map by the plant north offset", () => {
    const [x, z] = toAssetXZ(origin.lat + 0.001, origin.lon, origin, 90);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(-111.32, 1);
  });

  it("covers the origin with a bounded set of streets tiles just under the datum", () => {
    const tiles = groundTiles(origin, 0, "http://b/api/v1/basemap/streets/{z}/{x}/{y}?token=t", 150);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(MAX_GROUND_TILES);
    expect(tiles[0].url).toMatch(/\/basemap\/streets\/\d+\/\d+\/\d+\?token=t$/);
    expect(tiles.every((t) => t.y < 0 && t.y > -0.2)).toBe(true);
    // the origin (0, 0) falls inside one tile: x between its top and bottom edge, z between left and right
    const holder = tiles.find((t) => t.bl[0] <= 0 && t.tl[0] >= 0 && t.tl[1] <= 0 && t.tr[1] >= 0);
    expect(holder).toBeDefined();
  });

  it("caps the tile count for a huge radius", () => {
    expect(groundTiles(origin, 0, "{z}/{x}/{y}", 50_000).length).toBeLessThanOrEqual(MAX_GROUND_TILES);
  });
});
