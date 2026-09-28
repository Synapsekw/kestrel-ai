import { describe, expect, it } from "vitest";
import { errorBody, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { exampleFindingDetail, TYPE_CRACK } from "@/test/findingFixtures";
import { LAYERS, LOCAL, MAP_SEP, SEP, SHOWN_ALL, UTM38 } from "@/mapws/test/w3Fixtures";
import {
  FINDINGS_LOCAL,
  FindingRefusal,
  MAX_FINDING_VERTICES,
  NO_ORTHO,
  anchorMapFor,
  createMapFinding,
  findingFailure,
  findingToolUnavailable,
  isFindingRefusal,
  siteGeometry,
} from "./actions";

const inside = [500500, 3300500];
const ring = [
  [500400, 3300400],
  [500600, 3300400],
  [500600, 3300600],
];
const mapGeometry = { type: "Point", coordinates: [583120.4, 3265410.2] };

describe("finding geometry", () => {
  it("a point is its click; a polygon is closed once", () => {
    expect(siteGeometry("point", [inside])).toEqual({
      type: "Point",
      coordinates: inside,
    });
    expect(siteGeometry("polygon", [...ring, ring[0]])).toEqual({
      type: "Polygon",
      coordinates: [[...ring, ring[0]]],
    });
  });

  it("refuses a polygon with fewer than three corners or more than the cap", () => {
    expect(() => siteGeometry("polygon", ring.slice(0, 2))).toThrow("at least three corners");
    const many = Array.from({ length: MAX_FINDING_VERTICES + 1 }, (_, i) => [i, (i * i) % 7]);
    expect(() => siteGeometry("polygon", many)).toThrow(`at most ${MAX_FINDING_VERTICES}`);
  });
});

describe("anchorMapFor (W3-5)", () => {
  it("picks the right date's ortho under the point or the polygon's centroid", () => {
    expect(anchorMapFor(LAYERS, SHOWN_ALL, SEP, "point", [inside])).toEqual({
      mapId: MAP_SEP,
    });
    expect(anchorMapFor(LAYERS, SHOWN_ALL, SEP, "polygon", ring)).toEqual({
      mapId: MAP_SEP,
    });
  });

  it("refuses without an ortho under the click", () => {
    expect(anchorMapFor(LAYERS, SHOWN_ALL, SEP, "point", [[900000, 3300500]])).toEqual({
      refusal: NO_ORTHO,
    });
    const noSep = LAYERS.filter((l) => l.id !== MAP_SEP);
    expect(anchorMapFor(noSep, SHOWN_ALL, SEP, "point", [inside])).toEqual({
      refusal: NO_ORTHO,
    });
  });
});

describe("findingToolUnavailable", () => {
  it("is off in a local frame and without any ortho", () => {
    expect(findingToolUnavailable({ frame: UTM38, layers: LAYERS })).toBeNull();
    expect(findingToolUnavailable({ frame: LOCAL, layers: LAYERS })).toBe(FINDINGS_LOCAL);
    expect(
      findingToolUnavailable({
        frame: UTM38,
        layers: LAYERS.filter((l) => l.kind !== "map"),
      }),
    ).toBe("Findings need an orthomosaic — import one");
  });
});

describe("createMapFinding", () => {
  it("converts the site geometry, then creates F's finding with the map anchor", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/map-workspace\/anchor$/,
        body: {
          map_id: MAP_SEP,
          geometry: mapGeometry,
          lon: 47.76,
          lat: 29.49,
        },
      },
      {
        method: "POST",
        path: /\/findings$/,
        status: 201,
        body: exampleFindingDetail,
      },
    ]);
    const f = await createMapFinding(api, PROJECT_ID, {
      shape: "point",
      coords: [inside],
      mapId: MAP_SEP,
      typeId: TYPE_CRACK,
    });
    expect(f.id).toBe(exampleFindingDetail.id);
    expect(requests.map((r) => r.body)).toEqual([
      {
        map_id: MAP_SEP,
        geometry_site: { type: "Point", coordinates: inside },
      },
      {
        type_id: TYPE_CRACK,
        anchor: { kind: "map", map_id: MAP_SEP, geometry: mapGeometry },
        lon: 47.76,
        lat: 29.49,
      },
    ]);
  });

  it("a map with no coordinates explains itself and creates nothing", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/map-workspace\/anchor$/,
        status: 422,
        body: errorBody("no_coordinates", "x"),
      },
    ]);
    const err = await createMapFinding(api, PROJECT_ID, {
      shape: "point",
      coords: [inside],
      mapId: MAP_SEP,
      typeId: TYPE_CRACK,
    }).catch((e: unknown) => e);
    expect(findingFailure(err)).toBe(NO_ORTHO);
    expect(isFindingRefusal(err)).toBe(true);
    expect(requests.some((r) => r.url.endsWith("/findings"))).toBe(false);
  });

  it("an outline over the cap is refused before anything is sent", async () => {
    const { api, requests } = fakeClient([]);
    const many = Array.from({ length: MAX_FINDING_VERTICES + 1 }, (_, i) => [
      500000 + i,
      3300000 + ((i * i) % 7),
    ]);
    const err = await createMapFinding(api, PROJECT_ID, {
      shape: "polygon",
      coords: many,
      mapId: MAP_SEP,
      typeId: TYPE_CRACK,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FindingRefusal);
    expect(requests).toEqual([]);
  });

  it("maps the server's refusals to the spec's copy (W3-5, P11)", () => {
    const env = (code: string) => ({ error: { code, message: "x", details: {} } });
    expect(findingFailure(env("not_implemented"))).toBe("Map findings need the map workspace backend (M-B1)");
    expect(findingFailure(env("local_frame"))).toBe(FINDINGS_LOCAL);
    expect(findingFailure(env("outside_map"))).toBe(NO_ORTHO);
    expect(isFindingRefusal(env("outside_map"))).toBe(true);
    expect(isFindingRefusal(env("local_frame"))).toBe(true);
    expect(isFindingRefusal(env("internal"))).toBe(false);
    expect(isFindingRefusal(new FindingRefusal("x"))).toBe(true);
  });
});
