import { describe, expect, it } from "vitest";
import { MAP_ID, PROJECT_ID, exampleGeoMap } from "@/test/fixtures";
import { exampleFinding, exampleFinding2 } from "@/test/findingFixtures";
import { LOCAL, UTM33 } from "../test/fixtures";
import {
  ARRIVAL_RESOLUTION,
  LOCAL_FINDING_NOTICE,
  NO_LOCATION_NOTICE,
  arrivalRequest,
  mapSurveyDate,
  planFindingArrival,
  planMapArrival,
  stripArrival,
} from "./arrival";

// exampleFinding2 is anchored on exampleGeoMap (UTM 33N); put its lon/lat inside that map.
const onMap = { ...exampleFinding2, lon: 15.01, lat: 44.99 };

describe("arrival (spec §5, §9.4, R-W1-6)", () => {
  it("reads what the link asks for", () => {
    expect(arrivalRequest(new URLSearchParams(`map=${MAP_ID}&finding=f1`))).toEqual({
      kind: "finding",
      findingId: "f1",
      mapId: MAP_ID,
    });
    expect(arrivalRequest(new URLSearchParams("map=m1&at=500100.5,4982000"))).toEqual({
      kind: "map",
      mapId: "m1",
      at: [500100.5, 4982000],
    });
    expect(arrivalRequest(new URLSearchParams("map=m1&at=nonsense"))).toEqual({
      kind: "map",
      mapId: "m1",
      at: null,
    });
    expect(arrivalRequest(new URLSearchParams("tool=zone"))).toEqual({
      kind: "tool",
      toolId: "zone",
    });
    expect(arrivalRequest(new URLSearchParams("r=2026-09-14"))).toEqual({
      kind: "none",
    });
    expect(
      stripArrival(new URLSearchParams("map=m&finding=f&at=1,2&tool=zone&r=2026-09-14")).toString(),
    ).toBe("r=2026-09-14");
  });

  it("centres on the finding, selects it and picks its map's date", () => {
    const plan = planFindingArrival({
      projectId: PROJECT_ID,
      requestedMapId: MAP_ID,
      finding: onMap,
      anchorMap: exampleGeoMap,
      frame: UTM33,
    });
    if (plan.kind !== "arrive") throw new Error(plan.kind);
    expect(plan.r).toBe("2026-04-15");
    expect(plan.selection).toEqual({ kind: "finding", id: onMap.id });
    expect(plan.resolution).toBe(ARRIVAL_RESOLUTION);
    const [e, n] = plan.centre!;
    const [minE, minN, maxE, maxN] = exampleGeoMap.bounds_native!;
    expect(e).toBeGreaterThan(minE);
    expect(e).toBeLessThan(maxE);
    expect(n).toBeGreaterThan(minN);
    expect(n).toBeLessThan(maxN);
    expect(plan.notice).toBeNull();
  });

  it("redirects a finding anchored on another map to its own map", () => {
    expect(
      planFindingArrival({
        projectId: PROJECT_ID,
        requestedMapId: "other-map",
        finding: onMap,
        anchorMap: null,
        frame: UTM33,
      }),
    ).toEqual({
      kind: "navigate",
      to: `/p/${PROJECT_ID}/maps?map=${MAP_ID}&finding=${onMap.id}`,
    });
  });

  it("sends an image finding to the image workspace", () => {
    const plan = planFindingArrival({
      projectId: PROJECT_ID,
      requestedMapId: MAP_ID,
      finding: exampleFinding,
      anchorMap: null,
      frame: UTM33,
    });
    expect(plan).toEqual({
      kind: "navigate",
      to: expect.stringMatching(/\/images\/.+\?finding=/),
    });
  });

  it("opens the inspector without centring in a local frame, and says why", () => {
    const plan = planFindingArrival({
      projectId: PROJECT_ID,
      requestedMapId: MAP_ID,
      finding: onMap,
      anchorMap: exampleGeoMap,
      frame: LOCAL,
    });
    expect(plan).toMatchObject({
      kind: "arrive",
      centre: null,
      selection: { kind: "finding" },
      notice: LOCAL_FINDING_NOTICE,
    });
  });

  it("opens a finding with no location without centring", () => {
    const plan = planFindingArrival({
      projectId: PROJECT_ID,
      requestedMapId: null,
      finding: { ...onMap, lon: null, lat: null },
      anchorMap: exampleGeoMap,
      frame: UTM33,
    });
    expect(plan).toMatchObject({
      kind: "arrive",
      centre: null,
      notice: NO_LOCATION_NOTICE,
    });
  });

  it("dates a map by its capture date, else by its import date (R-W1-7)", () => {
    expect(mapSurveyDate(exampleGeoMap)).toBe("2026-04-15");
    expect(mapSurveyDate({ ...exampleGeoMap, captured_on: null })).toBe("2026-09-22");
  });

  it("centres a clouds jump (native CRS of the map) in the site frame", () => {
    const plan = planMapArrival({
      map: exampleGeoMap,
      at: [500100, 4982000],
      frame: UTM33,
    });
    if (plan.kind !== "arrive") throw new Error(plan.kind);
    expect(plan.centre![0]).toBeCloseTo(500100, 6);
    expect(plan.centre![1]).toBeCloseTo(4982000, 6);
    expect(plan.r).toBe("2026-04-15");
    expect(planMapArrival({ map: exampleGeoMap, at: null, frame: UTM33 })).toMatchObject({
      centre: null,
      r: "2026-04-15",
    });
  });
});
