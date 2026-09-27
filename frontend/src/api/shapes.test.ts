import { describe, expect, it } from "vitest";
import { errorBody, fakeClient, IMAGE_ID, PROJECT_ID } from "@/test/fixtures";
import { makeDetail, makeMeasurement, makeShape, makeWritten } from "@/images/canvas/testing";
import {
  bodyOf,
  createImageMeasurement,
  createShape,
  deleteImageMeasurement,
  fetchImageDetail,
  listImageMeasurements,
  reviewShapes,
  updateShape,
} from "./shapes";

describe("shape API", () => {
  it("sends confirm_finding_delete only when asked", async () => {
    const { api, requests } = fakeClient([
      { method: "PATCH", path: /\/boxes\/b1$/, body: makeWritten({ id: "b1" }) },
    ]);
    await updateShape(api, PROJECT_ID, "b1", { class_id: "c" });
    await updateShape(api, PROJECT_ID, "b1", { class_id: "c" }, { confirmFindingDelete: true });
    expect(requests[0].url).not.toContain("confirm_finding_delete");
    expect(requests[1].url).toContain("confirm_finding_delete=true");
  });

  it("returns the full review result", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/boxes\/review$/,
        body: { updated: 1, finding_ids_created: ["f1"], finding_ids_deleted: [] },
      },
    ]);
    const r = await reviewShapes(api, PROJECT_ID, ["b1"], "accept");
    expect(r.finding_ids_created).toEqual(["f1"]);
  });

  it("reads the image detail, and lists, creates and deletes measurements", async () => {
    const m = makeMeasurement();
    const { api, requests } = fakeClient([
      { method: "GET", path: new RegExp(`/images/${IMAGE_ID}$`), body: makeDetail() },
      { method: "GET", path: /\/measurements$/, body: { items: [m] } },
      { method: "POST", path: /\/measurements$/, status: 201, body: m },
      { method: "DELETE", path: /\/image-measurements\/[^/]+$/, status: 204, body: null },
    ]);
    expect((await fetchImageDetail(api, PROJECT_ID, IMAGE_ID)).width).toBe(4000);
    expect(await listImageMeasurements(api, PROJECT_ID, IMAGE_ID)).toEqual([m]);
    await createImageMeasurement(api, PROJECT_ID, IMAGE_ID, { x1: 1, y1: 2, x2: 3, y2: 4 });
    await deleteImageMeasurement(api, PROJECT_ID, m.id);
    expect(requests.map((r) => r.method)).toEqual(["GET", "GET", "POST", "DELETE"]);
  });

  it("surfaces a server refusal as ApiFailure with its code", async () => {
    const { api } = fakeClient([
      { method: "POST", path: /\/boxes$/, status: 422, body: errorBody("empty_polygon", "Nothing left") },
    ]);
    await expect(
      createShape(api, PROJECT_ID, IMAGE_ID, { class_id: "c", shape: "polygon", points: [] }),
    ).rejects.toMatchObject({
      code: "empty_polygon",
    });
  });

  it("rebuilds a create body from a shape of each kind", () => {
    expect(bodyOf(makeShape({ shape: "box", x: 1, y: 2, w: 3, h: 4, angle: 0 }))).toMatchObject({
      shape: "box",
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      angle: 0,
    });
    const poly = bodyOf(
      makeShape({
        shape: "polygon",
        points: [
          [0, 0],
          [10, 0],
          [0, 10],
        ],
        assist: "sam",
      }),
    );
    expect(poly).toEqual({
      class_id: expect.any(String),
      shape: "polygon",
      points: [
        [0, 0],
        [10, 0],
        [0, 10],
      ],
      assist: "sam",
    });
    expect(bodyOf(makeShape({ shape: "point", x: 5, y: 6, w: 0, h: 0 }))).toEqual({
      class_id: expect.any(String),
      shape: "point",
      x: 5,
      y: 6,
    });
  });
});
