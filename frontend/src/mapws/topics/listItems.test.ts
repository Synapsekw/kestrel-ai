import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS } from "../detect/detectModel";
import { detectionItems, extentOf, findingItems, measurementItems, zoneItems } from "./listItems";

const pin = (id: string, severity: number | null, status = "open") =>
  ({
    id,
    number: Number(id),
    type_id: "t",
    severity,
    status,
    created_by: "human",
    map_id: "m",
    geometry_site: { type: "Point", coordinates: [10, 20] },
  }) as never;

describe("list items", () => {
  it("findings follow the row filters, worst first, labelled by type and number", () => {
    const items = findingItems(
      [pin("1", 1), pin("2", 4), pin("3", 3, "closed")],
      { allSurveys: false, statuses: ["open"], minSeverity: null },
      () => "Crack",
    );
    expect(items.map((i) => i.id)).toEqual(["finding:2", "finding:1"]);
    expect(items[0]).toMatchObject({ label: "Crack", meta: "F-0002" });
  });

  it("zones are listed by name", () => {
    expect(zoneItems([{ id: "z", name: "Yard", category: "laydown" } as never])[0]).toMatchObject({
      id: "zone:z",
      label: "Yard",
    });
  });

  it("measurements follow the kind filter", () => {
    const m = (id: string, kind: string) => ({ id, kind, name: `M${id}` }) as never;
    expect(measurementItems([m("a", "distance"), m("b", "area")], ["area"]).map((i) => i.id)).toEqual([
      "measurement:b",
    ]);
  });

  it("extentOf bounds a ring and refuses nothing", () => {
    expect(
      extentOf([
        [0, 1],
        [4, -2],
        [2, 5],
      ]),
    ).toEqual([0, -2, 4, 5]);
    expect(extentOf([])).toBeNull();
  });

  it("detections: the review queue in view, pending first, filtered like the stage", () => {
    const d = (id: string, review_state: string, confidence: number, class_id = "c") =>
      ({ id, review_state, confidence, class_id }) as never;
    const byId = new Map([
      ["a", { runId: "r1", d: d("a", "accepted", 0.9) }],
      ["b", { runId: "r1", d: d("b", "unreviewed", 0.456) }],
      ["c", { runId: "r1", d: d("c", "rejected", 0.7) }],
      ["e", { runId: "r1", d: d("e", "unreviewed", 0.8, "hidden") }],
    ]);
    const items = detectionItems(
      { r1: ["a", "b", "c", "e", "gone"] },
      byId,
      { ...DEFAULT_FILTERS, hiddenTypes: new Set(["hidden"]) },
      () => ({ name: "Excavator", kind: "object" }),
    );
    expect(items).toEqual([
      { id: "detection:r1.b", label: "Excavator", meta: "46 %" },
      { id: "detection:r1.a", label: "Excavator", meta: "90 %" },
    ]);
  });
});
