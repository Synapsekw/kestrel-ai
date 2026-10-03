import { describe, expect, it } from "vitest";
import { exampleSite } from "@/test/findingFixtures";
import { basemapTiles, lonLatToTile, tileToLonLat } from "./basemapTiles";
import { siteFrame } from "./siteGeometry";

describe("basemapTiles", () => {
  const frame = siteFrame(exampleSite)!;

  it("round-trips between lon/lat and web-mercator tile coordinates", () => {
    const t = lonLatToTile(20.4612, 44.8125, 16);
    const back = tileToLonLat(t.x, t.y, 16);
    expect(back.lon).toBeCloseTo(20.4612, 9);
    expect(back.lat).toBeCloseTo(44.8125, 9);
  });

  it("picks a zoom where the frame spans about two tiles, so it never asks for more than 9", () => {
    const tiles = basemapTiles(frame);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(9);
    const z = tiles[0].z;
    expect(tiles.every((t) => t.z === z)).toBe(true);
    // The example site is ~0.5 km across: zoom 16 or 17 tiles are a few hundred metres wide.
    expect(z).toBeGreaterThanOrEqual(15);
    expect(z).toBeLessThanOrEqual(17);
  });

  it("covers the whole frame with its rectangles", () => {
    const tiles = basemapTiles(frame);
    const left = Math.min(...tiles.map((t) => t.left));
    const top = Math.min(...tiles.map((t) => t.top));
    const right = Math.max(...tiles.map((t) => t.left + t.width));
    const bottom = Math.max(...tiles.map((t) => t.top + t.height));
    expect(left).toBeLessThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(0);
    expect(right).toBeGreaterThanOrEqual(frame.width);
    expect(bottom).toBeGreaterThanOrEqual(frame.height);
  });

  it("places neighbouring tiles edge to edge", () => {
    const tiles = basemapTiles(frame);
    const a = tiles[0];
    const east = tiles.find((t) => t.x === a.x + 1 && t.y === a.y);
    const south = tiles.find((t) => t.x === a.x && t.y === a.y + 1);
    if (east) expect(east.left).toBeCloseTo(a.left + a.width, 9);
    if (south) expect(south.top).toBeCloseTo(a.top + a.height, 9);
    expect(east ?? south).toBeDefined();
  });

  it("never zooms past 19 for a tiny site", () => {
    const tiny = siteFrame({ ...exampleSite, bounds_wgs84: [20.46, 44.81, 20.46, 44.81] })!;
    expect(basemapTiles(tiny).every((t) => t.z <= 19)).toBe(true);
  });
});
