import { describe, expect, it } from "vitest";
import { fakeClient, runningJob } from "@/test/fixtures";
import {
  exampleDatasetItems,
  exampleLibraryDataset,
  examplePreview,
  LIB_DATASET_ID,
} from "@/test/appSectionFixtures";
import {
  createLibraryDataset,
  deleteLibraryDataset,
  exportLibraryDataset,
  fetchDatasetSamples,
  fetchLibraryDataset,
  fetchLibraryDatasets,
  previewDataset,
} from "./libraryDatasets";

describe("library datasets API (F §12.3)", () => {
  it("lists one page with a cursor", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/library\/datasets$/,
        body: { items: [exampleLibraryDataset], next_cursor: "c2" },
      },
    ]);
    const page = await fetchLibraryDatasets(api, "c1");
    expect(page.items[0].name).toBe("machines-v1");
    expect(page.next_cursor).toBe("c2");
    expect(requests[0].url).toContain("limit=100");
    expect(requests[0].url).toContain("cursor=c1");
  });

  it("reads, deletes and exports one dataset", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/library\/datasets\/[^/]+$/, body: exampleLibraryDataset },
      { method: "DELETE", path: /\/library\/datasets\/[^/]+$/, status: 204 },
      { method: "POST", path: /\/export$/, status: 202, body: { job: { ...runningJob, type: "dataset" } } },
    ]);
    expect((await fetchLibraryDataset(api, LIB_DATASET_ID)).id).toBe(LIB_DATASET_ID);
    await deleteLibraryDataset(api, LIB_DATASET_ID);
    expect((await exportLibraryDataset(api, LIB_DATASET_ID)).type).toBe("dataset");
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET /api/v1/library/datasets/${LIB_DATASET_ID}`,
      `DELETE /api/v1/library/datasets/${LIB_DATASET_ID}`,
      `POST /api/v1/library/datasets/${LIB_DATASET_ID}/export`,
    ]);
  });

  it("previews a filter and creates a dataset with its build job", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/library\/datasets\/preview$/, body: examplePreview },
      {
        method: "POST",
        path: /\/library\/datasets$/,
        status: 202,
        body: {
          dataset: { ...exampleLibraryDataset, state: "resolving" },
          job: { ...runningJob, type: "dataset_build" },
        },
      },
    ]);
    // Non-null: the fixture's `filter` is always populated (only a `legacy` dataset's is null).
    expect((await previewDataset(api, exampleLibraryDataset.filter!, "detect")).images).toBe(30);
    expect(requests[0].body).toEqual(exampleLibraryDataset.filter);
    const created = await createLibraryDataset(api, {
      name: "machines-v1",
      task: "detect",
      filter: exampleLibraryDataset.filter!,
      split_method: "by_group",
      val_fraction: 0.2,
      seed: 42,
    });
    expect(created.dataset.state).toBe("resolving");
    expect(created.job.type).toBe("dataset_build");
  });

  it("asks for 24 sample items", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/items$/, body: exampleDatasetItems }]);
    expect(await fetchDatasetSamples(api, LIB_DATASET_ID)).toHaveLength(1);
    expect(requests[0].url).toContain("limit=24");
  });
});
