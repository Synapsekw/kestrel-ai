import { describe, expect, it } from "vitest";
import { captureText, currentSighting, overlayRings, stepId } from "./nav";

const sighting = (id: string, image_id: string, annotation_id: string | null, extra: object = {}) =>
  ({
    id,
    finding_id: "f1",
    image_id,
    annotation_id,
    severity: 2,
    group_tag: null,
    placement: "patch",
    center: null,
    normal: null,
    part: null,
    coverage: null,
    placed_version: 1,
    representative: false,
    created_at: "",
    ...extra,
  }) as never;

const box = (id: string, extra: object = {}) =>
  ({
    id,
    image_id: "img-1",
    class_id: "t",
    x: 10,
    y: 20,
    w: 100,
    h: 50,
    angle: 0,
    points: null,
    ...extra,
  }) as never;

describe("split inspection navigation", () => {
  it("steps without wrapping", () => {
    expect(stepId(["a", "b", "c"], "b", 1)).toBe("c");
    expect(stepId(["a", "b", "c"], "c", 1)).toBeNull();
    expect(stepId(["a", "b", "c"], "a", -1)).toBeNull();
    expect(stepId(["a", "b"], null, 1)).toBe("a");
    expect(stepId(["a", "b"], "gone", 1)).toBe("a");
    expect(stepId([], null, 1)).toBeNull();
  });

  it("opens the asked sighting, else the representative, else the first", () => {
    const list = [sighting("s1", "img-1", "b1"), sighting("s2", "img-2", "b2", { representative: true })];
    expect(currentSighting(list, "s1")?.id).toBe("s1");
    expect(currentSighting(list, null)?.id).toBe("s2");
    expect(currentSighting(list, "gone")?.id).toBe("s2");
    expect(currentSighting([sighting("s9", "img-9", null)], null)?.id).toBe("s9");
    expect(currentSighting([], null)).toBeNull();
  });

  it("rings the finding's polygons and boxes on this photo only", () => {
    const boxes = {
      b1: box("b1", {
        points: [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
      }),
      b2: box("b2"),
      other: box("other"),
    };
    const sightings = [
      sighting("s1", "img-1", "b1"),
      sighting("s2", "img-1", "b2", { severity: 3 }),
      sighting("s3", "img-2", "b3"),
    ];
    const rings = overlayRings(boxes, sightings, "img-1", (s) => (s === 3 ? "#ff9c3a" : "#e2bf2e"));
    expect(rings.map((r) => r.id)).toEqual(["s1", "s2"]);
    expect(rings[0]).toEqual({ id: "s1", points: [0, 0, 10, 0, 10, 10], colour: "#e2bf2e" });
    expect(rings[1].points).toEqual([10, 20, 110, 20, 110, 70, 10, 70]);
    expect(rings[1].colour).toBe("#ff9c3a");
  });

  it("formats the capture time for the HUD", () => {
    expect(captureText("2026-09-14T06:05:00Z")).toMatch(/14 Sept? 2026/);
    expect(captureText(null)).toBeNull();
  });
});
