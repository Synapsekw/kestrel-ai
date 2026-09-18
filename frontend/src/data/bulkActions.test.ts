import { describe, it, expect } from "vitest";
import { exampleJob, fakeClient, PROJECT_ID, MODEL_ID, errorBody } from "@/test/fixtures";
import { addImagesToDataset, deleteImages, runModelOnImages } from "./bulkActions";

describe("bulk actions", () => {
  it("posts a local-model query run, a dataset with image ids and a bulk delete", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/query-runs$/,
        status: 202,
        body: { query_run: { id: "q" }, job: exampleJob },
      },
      {
        method: "POST",
        path: /\/datasets$/,
        status: 202,
        body: { dataset: { id: "d" }, job: { ...exampleJob, id: "j2", type: "dataset" } },
      },
      { method: "POST", path: /\/images\/bulk-delete$/, body: { deleted: 2 } },
    ]);
    expect((await runModelOnImages(api, PROJECT_ID, ["a", "b"], MODEL_ID)).id).toBe(exampleJob.id);
    expect(
      (
        await addImagesToDataset(api, PROJECT_ID, ["a", "b"], {
          name: "v1",
          split_method: "by_group",
          val_fraction: 0.2,
        })
      ).id,
    ).toBe("j2");
    expect(await deleteImages(api, PROJECT_ID, ["a", "b"])).toBe(2);
    expect(requests[0].body).toEqual({
      kind: "local_model",
      model_id: MODEL_ID,
      image_ids: ["a", "b"],
      conf: 0.25,
    });
    expect(requests[1].body).toEqual({
      name: "v1",
      split_method: "by_group",
      val_fraction: 0.2,
      seed: 42,
      image_ids: ["a", "b"],
    });
    expect(requests[2].body).toEqual({ image_ids: ["a", "b"] });
  });

  it("surfaces the 501 envelope until S4 lands", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/query-runs$/,
        status: 501,
        body: errorBody("not_implemented", "query runs arrive with S4"),
      },
    ]);
    await expect(runModelOnImages(api, PROJECT_ID, ["a"], MODEL_ID)).rejects.toMatchObject({
      message: "query runs arrive with S4",
    });
  });
});
