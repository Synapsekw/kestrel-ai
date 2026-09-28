import { describe, expect, it } from "vitest";
import { errorBody, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { listSiteAreasInFrame } from "@/api/siteAreas";
import { toWgs84 } from "@/mapws/annotations/bindings";
import { LOCAL, UTM38 } from "@/mapws/test/w3Fixtures";
import {
  MAX_ZONE_VERTICES,
  ZONES_LOCAL,
  ZoneRefusal,
  createZone,
  siteRingToWgs84,
  zoneFailure,
  zoneToolUnavailable,
} from "./actions";

const ring = [
  [500000, 3300000],
  [501000, 3300000],
  [501000, 3301000],
];

describe("zones", () => {
  it("converts a site ring to an open WGS84 outline with the site CRS (W3-3)", () => {
    const out = siteRingToWgs84([...ring, ring[0]], toWgs84(UTM38));
    expect(out).toHaveLength(3);
    expect(out[0][0]).toBeCloseTo(45, 7); // UTM 38's central meridian
    expect(out[0][1]).toBeCloseTo(29.83046732, 6);
  });

  it("refuses a local frame, fewer than three corners, or more than the site-area cap", () => {
    expect(() => siteRingToWgs84(ring, null)).toThrow(ZONES_LOCAL);
    expect(() => siteRingToWgs84(ring.slice(0, 2), toWgs84(UTM38))).toThrow(ZoneRefusal);
    const many = Array.from({ length: MAX_ZONE_VERTICES + 1 }, (_, i) => [500000 + i, 3300000 + (i % 2)]);
    expect(() => siteRingToWgs84(many, toWgs84(UTM38))).toThrow(`at most ${MAX_ZONE_VERTICES}`);
    expect(zoneToolUnavailable({ frame: UTM38 })).toBeNull();
    expect(zoneToolUnavailable({ frame: LOCAL })).toBe(ZONES_LOCAL);
  });

  it("creates a site area with its name, category and WGS84 outline", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/site-areas$/,
        status: 201,
        body: (r) => ({
          id: "z1",
          created_at: "2026-09-27T10:00:00Z",
          ...(r.body as object),
        }),
      },
    ]);
    const area = await createZone(api, PROJECT_ID, {
      name: "Crane exclusion",
      category: "exclusion",
      ring,
      frame: UTM38,
    });
    expect(area.id).toBe("z1");
    expect(requests[0].body).toMatchObject({
      name: "Crane exclusion",
      category: "exclusion",
    });
    expect((requests[0].body as { polygon_wgs84: number[][] }).polygon_wgs84).toHaveLength(3);
  });

  it("a refusal keeps its own text and sends nothing; a server failure shows the server's message", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/site-areas$/,
        status: 422,
        body: errorBody("invalid_outline", "the outline has a point that is not finite"),
      },
    ]);
    const refused = await createZone(api, PROJECT_ID, {
      name: "Yard",
      category: "laydown",
      ring,
      frame: LOCAL,
    }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ZoneRefusal);
    expect(zoneFailure(refused)).toBe(ZONES_LOCAL);
    expect(requests).toHaveLength(0);

    const failed = await createZone(api, PROJECT_ID, {
      name: "Yard",
      category: "laydown",
      ring,
      frame: UTM38,
    }).catch((e: unknown) => e);
    expect(failed).not.toBeInstanceOf(ZoneRefusal);
    expect(zoneFailure(failed)).toBe("the outline has a point that is not finite");
  });

  it("lists the site areas with their site-frame outline (frame=site)", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/site-areas$/,
        body: {
          items: [{ id: "z1", name: "Yard", category: "laydown", polygon_wgs84: [], created_at: "x" }],
        },
      },
    ]);
    const items = await listSiteAreasInFrame(api, PROJECT_ID);
    expect(items.map((a) => a.id)).toEqual(["z1"]);
    expect(requests[0].url).toMatch(/\/site-areas\?frame=site$/);
  });
});
