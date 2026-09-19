import { describe, it, expect } from "vitest";
import { DATASET_ID, errorBody, exampleDataset, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { createDataset, deleteDataset, fetchDataset, fetchDatasets, fetchDatasetStats } from "./datasets";

describe("datasets api", () => {
  it("lists, gets, reads stats and creates with the split parameters and seed", async () => {
    const stats = { image_count: 30, train_count: 24, val_count: 6, boxes_per_class: [], groups: [] };
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/datasets$/, body: { items: [exampleDataset], next_cursor: null } },
      { method: "GET", path: /\/datasets\/[^/]+\/stats$/, body: stats },
      { method: "GET", path: /\/datasets\/[^/]+$/, body: exampleDataset },
      {
        method: "POST",
        path: /\/datasets$/,
        status: 202,
        body: { dataset: exampleDataset, job: { ...runningJob, type: "dataset" } },
      },
    ]);
    expect((await fetchDatasets(api, PROJECT_ID)).map((d) => d.name)).toEqual(["v1"]);
    expect((await fetchDatasetStats(api, PROJECT_ID, DATASET_ID)).train_count).toBe(24);
    expect((await fetchDataset(api, PROJECT_ID, DATASET_ID)).id).toBe(DATASET_ID);
    const created = await createDataset(api, PROJECT_ID, {
      name: "v2",
      split_method: "random",
      val_fraction: 0.3,
      seed: 7,
      image_ids: ["a", "b"],
    });
    expect(created.job.type).toBe("dataset");
    expect(requests[3]).toMatchObject({
      method: "POST",
      url: `/api/v1/projects/${PROJECT_ID}/datasets`,
      body: { name: "v2", split_method: "random", val_fraction: 0.3, seed: 7, image_ids: ["a", "b"] },
    });
  });

  it("surfaces 501 until S1 lands", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/datasets$/, status: 501, body: errorBody("not_implemented", "S1 later") },
    ]);
    await expect(fetchDatasets(api, PROJECT_ID)).rejects.toMatchObject({ status: 501 });
  });

  it("deletes a dataset", async () => {
    const { api, requests } = fakeClient([{ method: "DELETE", path: /\/datasets\/[^/]+$/, status: 204 }]);
    await deleteDataset(api, PROJECT_ID, DATASET_ID);
    expect(requests[0]).toMatchObject({
      method: "DELETE",
      url: `/api/v1/projects/${PROJECT_ID}/datasets/${DATASET_ID}`,
    });
  });

  it("surfaces the 409 conflict when a job uses the dataset", async () => {
    const { api } = fakeClient([
      {
        method: "DELETE",
        path: /\/datasets\/[^/]+$/,
        status: 409,
        body: errorBody("conflict", "dataset 'v1' is in use by a running job"),
      },
    ]);
    await expect(deleteDataset(api, PROJECT_ID, DATASET_ID)).rejects.toMatchObject({ status: 409 });
  });
});
