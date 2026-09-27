import { describe, expect, it } from "vitest";
import { createShape, fetchImageDetail } from "@/api/shapes";
import { fetchBoxes } from "@/api/boxes";
import { createLabApi, LAB_IMAGE_ID, LAB_PROJECT_ID, LAB_TYPES, seedShapes } from "./labApi";

describe("canvas lab API", () => {
  it("seeds the §17 flow-6 load: 300 polygons of 40 vertices and 200 boxes", () => {
    const shapes = seedShapes(500, LAB_IMAGE_ID);
    expect(shapes.filter((s) => s.shape === "polygon")).toHaveLength(300);
    expect(shapes.filter((s) => s.shape === "box")).toHaveLength(200);
    expect(shapes.find((s) => s.shape === "polygon")!.points).toHaveLength(40);
  });

  it("serves the image and stores a created polygon with its envelope and area", async () => {
    const { api } = createLabApi({ shapes: 0, types: LAB_TYPES });
    expect((await fetchImageDetail(api, LAB_PROJECT_ID, LAB_IMAGE_ID)).width).toBe(4000);
    const made = await createShape(api, LAB_PROJECT_ID, LAB_IMAGE_ID, {
      class_id: LAB_TYPES[0].id,
      shape: "polygon",
      points: [
        [100, 100],
        [300, 100],
        [300, 200],
      ],
    });
    expect(made).toMatchObject({ x: 100, y: 100, w: 200, h: 100, area_px: 10000 });
    expect(made.finding_id).not.toBeNull(); // LAB_TYPES[0] is a defect type
    expect(await fetchBoxes(api, LAB_PROJECT_ID, LAB_IMAGE_ID)).toHaveLength(1);
  });
});
