import { describe, expect, it } from "vitest";
import type Polygon from "ol/geom/Polygon";
import { SELECTION_PROP } from "@/mapws/w4host";
import { exampleMeasurement } from "@/test/volumeFixtures";
import { closeRing, maskFeatures, openRing, volumeFeature, withExclusion } from "./volumeFeatures";

const ring = [
  [0, 0],
  [10, 0],
  [10, 10],
];

describe("volume features", () => {
  it("closes and opens rings", () => {
    expect(closeRing(ring)).toEqual([...ring, [0, 0]]);
    expect(openRing(closeRing(ring))).toEqual(ring);
  });

  it("makes a selectable measurement polygon in site coordinates", () => {
    const f = volumeFeature("v1", ring, true);
    expect(f.get(SELECTION_PROP)).toEqual({ kind: "volume", id: "v1" });
    expect(f.get("role")).toBe("measure");
    expect(f.get("selected")).toBe(true);
    expect((f.getGeometry() as Polygon).getCoordinates()[0]).toEqual(closeRing(ring));
  });

  it("draws footprints always and native masks only in the identity frame, never selectable", () => {
    const m = {
      ...exampleMeasurement,
      alignment: { ...exampleMeasurement.alignment, stable_polygon: ring },
      masks: {
        ...exampleMeasurement.masks,
        exclusion_polygons: [{ id: "e1", ring, mode: "exclude" as const }],
      },
    };
    const same = maskFeatures(m, [ring], true);
    expect(same.map((f) => f.get("role"))).toEqual(["footprint", "exclusion", "stable"]);
    expect(same.every((f) => f.get(SELECTION_PROP) === undefined)).toBe(true);
    expect(same[1].get("mode")).toBe("exclude");
    expect(maskFeatures(m, [ring], false).map((f) => f.get("role"))).toEqual(["footprint"]);
  });

  it("adds an exclusion as a patch with the existing ones kept", () => {
    const m = {
      ...exampleMeasurement,
      masks: {
        ...exampleMeasurement.masks,
        exclusion_polygons: [{ id: "e1", ring, mode: "patch" as const }],
      },
    };
    expect(withExclusion(m, ring, "e2")).toEqual({
      masks: {
        exclusion_polygons: [
          { id: "e1", ring, mode: "patch" },
          { id: "e2", ring, mode: "patch" },
        ],
      },
    });
  });
});
