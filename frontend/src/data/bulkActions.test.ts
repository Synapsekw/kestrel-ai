import { describe, it, expect } from "vitest";
import { errorBody, exampleDataset, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { addImagesToDataset, deleteImages } from "./bulkActions";

describe("bulk actions", () => {
  it("posts a dataset with the split options, seed and image ids, and a bulk delete", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/datasets$/,
        status: 202,
        body: { dataset: exampleDataset, job: { ...runningJob, type: "dataset" } },
      },
      { method: "POST", path: /\/images\/bulk-delete$/, body: { deleted: 2 } },
    ]);
    const created = await addImagesToDataset(api, PROJECT_ID, ["a", "b"], {
      name: "v1",
      split_method: "by_group",
      val_fraction: 0.2,
      seed: 7,
    });
    expect(created.dataset.id).toBe(exampleDataset.id);
    expect(created.job.type).toBe("dataset");
    expect(requests[0].body).toEqual({
      name: "v1",
      split_method: "by_group",
      val_fraction: 0.2,
      seed: 7,
      image_ids: ["a", "b"],
    });
    expect(await deleteImages(api, PROJECT_ID, ["a", "b"])).toBe(2);
    expect(requests[1].body).toEqual({ image_ids: ["a", "b"] });
  });

  it("surfaces the 501 envelope until S1 lands", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/datasets$/,
        status: 501,
        body: errorBody("not_implemented", "datasets arrive with S1"),
      },
    ]);
    await expect(
      addImagesToDataset(api, PROJECT_ID, ["a"], {
        name: "v1",
        split_method: "random",
        val_fraction: 0.2,
        seed: 42,
      }),
    ).rejects.toMatchObject({ message: "datasets arrive with S1" });
  });
});
