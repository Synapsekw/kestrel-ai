import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SITE_MAX_Z, SITE_TILE, maxZoomFor, siteRes, siteResolutions, tileAt, tileBounds } from "./siteGrid";

/** M-C0's shared vectors (spec §6: "both are tested on the same vectors"); grid.py reads the same file. */
interface Vectors {
  tile_px: number;
  res: { z: number; res: number }[];
  tiles: { z: number; e: number; n: number; x: number; y: number }[];
  bounds: {
    z: number;
    x: number;
    y: number;
    minx: number;
    miny: number;
    maxx: number;
    maxy: number;
  }[];
  max_zoom: { native_m: number; max_zoom: number }[];
}

const SHARED: Vectors = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../contract/fixtures/site-grid-vectors.json"), "utf8"),
) as Vectors;

/** W1's own extra cases (UTM 33N around the contract's example map); same formulas. */
const EXTRA = {
  tiles: [
    { z: 0, e: 500123.45, n: 4981234.5, x: 1, y: -20 },
    { z: 10, e: 500123.45, n: 4981234.5, x: 1953, y: -19458 },
    { z: 17, e: 500123.45, n: 4981234.5, x: 250061, y: -2490618 },
    { z: 10, e: -10.5, n: -3.25, x: -1, y: 0 },
    { z: 10, e: 256, n: -256, x: 1, y: 1 },
  ],
  bounds: [
    {
      z: 10,
      x: 1953,
      y: -19458,
      minx: 499968,
      miny: 4980992,
      maxx: 500224,
      maxy: 4981248,
    },
    { z: 10, x: -1, y: -1, minx: -256, miny: 0, maxx: 0, maxy: 256 },
  ],
  max_zoom: [
    { native_m: 0.03, max_zoom: 17 },
    { native_m: 4096, max_zoom: 0 },
  ],
};

function check(v: Pick<Vectors, "tiles" | "bounds" | "max_zoom">) {
  for (const t of v.tiles)
    expect(tileAt(t.e, t.n, t.z), JSON.stringify(t)).toEqual({
      z: t.z,
      x: t.x,
      y: t.y,
    });
  for (const b of v.bounds)
    expect(tileBounds({ z: b.z, x: b.x, y: b.y })).toEqual([b.minx, b.miny, b.maxx, b.maxy]);
  for (const m of v.max_zoom) expect(maxZoomFor(m.native_m), String(m.native_m)).toBe(m.max_zoom);
}

describe("site tile grid (spec §6)", () => {
  it("matches contract/fixtures/site-grid-vectors.json", () => {
    expect(SHARED.tile_px).toBe(SITE_TILE);
    for (const r of SHARED.res) expect(siteRes(r.z)).toBe(r.res);
    check(SHARED);
  });

  it("matches W1's extra UTM 33N cases, never returning -0", () => {
    check(EXTRA);
    expect(Object.is(tileAt(0, 0, 5).y, 0)).toBe(true);
    expect(Object.is(tileBounds({ z: 10, x: -1, y: -1 })[1], 0)).toBe(true);
  });

  it("halves the resolution per zoom from 1024 m/px at z 0 to z 20", () => {
    expect(siteResolutions()).toHaveLength(SITE_MAX_Z + 1);
    expect(() => siteRes(21)).toThrow(RangeError);
    expect(() => siteRes(-1)).toThrow(RangeError);
  });

  it("puts every point inside the bounds of its own tile", () => {
    for (const t of [...SHARED.tiles, ...EXTRA.tiles]) {
      const [minE, minN, maxE, maxN] = tileBounds(tileAt(t.e, t.n, t.z));
      expect(t.e).toBeGreaterThanOrEqual(minE);
      expect(t.e).toBeLessThan(maxE);
      expect(t.n).toBeGreaterThan(minN);
      expect(t.n).toBeLessThanOrEqual(maxN);
    }
  });

  it("refuses a non-positive native resolution", () => {
    expect(() => maxZoomFor(0)).toThrow(RangeError);
    expect(() => maxZoomFor(Number.NaN)).toThrow(RangeError);
  });
});
