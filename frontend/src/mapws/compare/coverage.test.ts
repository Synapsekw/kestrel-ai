import { describe, expect, it } from "vitest";
import type { Placement } from "../layers/placement";
import { hasDataIn, intersects, sideExtent, viewExtent } from "./coverage";

const placed = (
  side: Placement["side"],
  footprint: number[] | null,
  date: string | null = "2026-08-14",
) => ({ side, row: { date, layer: { footprint_site: footprint } } }) as unknown as Placement;

describe("coverage (M §14 non-overlapping footprints)", () => {
  it("intersects boxes, touching edges excluded", () => {
    expect(intersects([0, 0, 10, 10], [5, 5, 20, 20])).toBe(true);
    expect(intersects([0, 0, 10, 10], [10, 0, 20, 10])).toBe(false);
  });

  it("derives the view's bounding extent from centre, resolution, rotation and size", () => {
    expect(
      viewExtent(
        { center: [100, 50], resolution: 0.5, rotation: 0 },
        [400, 200],
      ),
    ).toEqual([0, 0, 200, 100]);
    const r = viewExtent(
      { center: [0, 0], resolution: 1, rotation: Math.PI / 2 },
      [400, 200],
    );
    expect(r.map((v) => Math.round(v))).toEqual([-100, -200, 100, 200]);
  });

  it("splits the extent at the divider", () => {
    expect(sideExtent([0, 0, 100, 50], 25, "left")).toEqual([0, 0, 25, 50]);
    expect(sideExtent([0, 0, 100, 50], 25, "right")).toEqual([25, 0, 100, 50]);
  });

  it("finds data on a side from its own dated placements; a missing footprint counts as data", () => {
    const ps = [
      placed("left", [0, 0, 10, 10]),
      placed("right", [100, 100, 110, 110]),
      placed("both", [0, 0, 999, 999], null),
    ];
    expect(hasDataIn([0, 0, 20, 20], ps, "left")).toBe(true);
    expect(hasDataIn([0, 0, 20, 20], ps, "right")).toBe(false);
    expect(hasDataIn([0, 0, 20, 20], [placed("right", null)], "right")).toBe(
      true,
    );
  });
});
