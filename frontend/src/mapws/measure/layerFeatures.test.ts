import { describe, expect, it } from "vitest";
import { MAP_SEP, measurement } from "@/mapws/test/w3Fixtures";
import {
  hoverIndexAt,
  hoverPoint,
  measureFilters,
  measurementsMeta,
  measurementsRows,
} from "./layerFeatures";

// A 100 m straight line whose server chainage is ground metres (a little longer than grid).
const line = [
  [0, 0],
  [100, 0],
];
const stations = [0, 25.01, 50.02, 75.03, 100.04];

describe("profile hover sync (spec §9.2)", () => {
  it("the map pointer picks the station at the same fraction of the line", () => {
    expect(hoverIndexAt(line, stations, [49, 3])).toBe(2);
    expect(hoverIndexAt(line, stations, [-10, 0])).toBe(0);
    expect(hoverIndexAt(line, stations, [130, 0])).toBe(4);
  });

  it("a chart station puts the marker at the same fraction along the drawn line", () => {
    const [x, y] = hoverPoint(line, stations, 2);
    expect(x).toBeCloseTo(50, 9);
    expect(y).toBe(0);
    expect(hoverPoint(line, stations, 4)).toEqual([100, 0]);
  });

  it("a degenerate profile keeps the marker on the first vertex", () => {
    expect(hoverPoint([[5, 5]], [0], 0)).toEqual([5, 5]);
    expect(hoverIndexAt([[5, 5]], [0], [9, 9])).toBe(0);
  });
});

describe("the Measurements row", () => {
  it("counts all and those on the right date's maps (spec §5.2 '9 · 3 on this map')", () => {
    const items = [measurement("distance"), measurement("area", { id: "x", map_id: "other" })];
    expect(measurementsMeta(items, false, [MAP_SEP])).toBe("2 · 1 on this map");
    expect(measurementsMeta(items, true, [])).toBe("2+");
    expect(measurementsMeta([], false, [MAP_SEP])).toBe("None yet");
  });

  it("reads its kind filter from the row style, all kinds by default", () => {
    expect(measureFilters({})).toEqual({
      kinds: ["distance", "area", "profile"],
    });
    expect(measureFilters({ kinds: ["area", "bogus"] })).toEqual({
      kinds: ["area"],
    });
  });

  it("is one static row in the Annotations group (W3-19)", () => {
    const rows = measurementsRows();
    expect(rows).toEqual([
      {
        key: "measurements:all",
        kind: "measurements",
        group: "annotations",
        id: "all",
        name: "Measurements",
        meta: "Distances, areas and profiles",
        date: null,
      },
    ]);
  });
});
