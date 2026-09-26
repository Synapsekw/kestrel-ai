import type { ApiClient, Job, components } from "@contract/client";
import { unwrap } from "./errors";
import type { Page } from "./paging";

type S = components["schemas"];
export type LibraryDataset = S["LibraryDataset"];
export type DatasetFilter = S["DatasetFilter"];
export type DatasetPreview = S["DatasetPreview"];
export type LibraryDatasetCreate = S["LibraryDatasetCreate"];
export type LibraryDatasetItem = S["LibraryDatasetItem"];
export type DatasetTask = LibraryDataset["task"];

export const DATASET_PAGE = 100;
/** The detail's sample grid (bounded: F §14). */
export const SAMPLE_COUNT = 24;

export async function fetchLibraryDatasets(api: ApiClient, cursor?: string): Promise<Page<LibraryDataset>> {
  const r = await unwrap(
    api.GET("/api/v1/library/datasets", {
      params: { query: { limit: DATASET_PAGE, ...(cursor ? { cursor } : {}) } },
    }),
  );
  return { items: r.items, next_cursor: r.next_cursor ?? null };
}

export function fetchLibraryDataset(api: ApiClient, datasetId: string): Promise<LibraryDataset> {
  return unwrap(api.GET("/api/v1/library/datasets/{datasetId}", { params: { path: { datasetId } } }));
}

/** Deletes the row and its export folder; project images are never touched (§12.3). */
export async function deleteLibraryDataset(api: ApiClient, datasetId: string): Promise<void> {
  await unwrap<unknown>(
    api.DELETE("/api/v1/library/datasets/{datasetId}", { params: { path: { datasetId } } }),
  );
}

/** COUNT queries only, with a per-project timeout on the server (§12.2 step 1). */
export function previewDataset(api: ApiClient, filter: DatasetFilter): Promise<DatasetPreview> {
  return unwrap(api.POST("/api/v1/library/datasets/preview", { body: filter }));
}

/** 202: the dataset (`state: resolving`) and its `dataset_build` job. */
export function createLibraryDataset(
  api: ApiClient,
  body: LibraryDatasetCreate,
): Promise<{ dataset: LibraryDataset; job: Job }> {
  return unwrap(api.POST("/api/v1/library/datasets", { body }));
}

/** 202: the YOLO export (`dataset` job). */
export async function exportLibraryDataset(api: ApiClient, datasetId: string): Promise<Job> {
  const r = await unwrap(
    api.POST("/api/v1/library/datasets/{datasetId}/export", { params: { path: { datasetId } } }),
  );
  return r.job;
}

export async function fetchDatasetSamples(api: ApiClient, datasetId: string): Promise<LibraryDatasetItem[]> {
  const r = await unwrap(
    api.GET("/api/v1/library/datasets/{datasetId}/items", {
      params: { path: { datasetId }, query: { limit: SAMPLE_COUNT } },
    }),
  );
  return r.items;
}
