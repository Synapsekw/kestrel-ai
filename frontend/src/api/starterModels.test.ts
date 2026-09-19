import { describe, it, expect } from "vitest";
import type { StarterModel } from "@contract/client";
import { exampleModel, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { importStarterModel, listStarterModels } from "./starterModels";

const starters: StarterModel[] = [
  { key: "yolo11n", name: "YOLO11 nano", description: "Fastest.", size_mb: 5.4, available: true },
  { key: "yolo11s", name: "YOLO11 small", description: "A little slower.", size_mb: 18.4, available: true },
  { key: "yolo11m", name: "YOLO11 medium", description: "Slowest.", size_mb: 0, available: false },
];

describe("starter models api", () => {
  it("lists the catalogue and imports one by key", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/starter-models$/, body: { items: starters, next_cursor: null } },
      {
        method: "POST",
        path: /\/models\/import-starter$/,
        status: 201,
        body: { ...exampleModel, name: "yolo11n-coco" },
      },
    ]);
    expect(await listStarterModels(api)).toEqual(starters);
    expect(requests[0]).toMatchObject({ method: "GET", url: "/api/v1/starter-models" });

    const model = await importStarterModel(api, PROJECT_ID, "yolo11n");
    expect(model.name).toBe("yolo11n-coco");
    expect(requests[1]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/models/import-starter`,
      body: { key: "yolo11n" },
    });
  });

  it("sends a name when one is given", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/models\/import-starter$/, status: 201, body: exampleModel },
    ]);
    await importStarterModel(api, PROJECT_ID, "yolo11s", "mine");
    expect(requests[0]).toMatchObject({ body: { key: "yolo11s", name: "mine" } });
  });
});
