import type { ApiClient, Dataset, DatasetStats, components } from "@contract/client";
import { unwrap } from "./errors";
import { collectPages } from "./paging";

export type DatasetCreate = components["schemas"]["DatasetCreate"];
export type DatasetWithJob = components["schemas"]["DatasetWithJob"];
export type SplitMethod = components["schemas"]["SplitMethod"];

const LIST_LIMIT = 1000;

export function fetchDatasets(api: ApiClient, projectId: string): Promise<Dataset[]> {
  return collectPages((cursor) =>
    unwrap(
      api.GET("/api/v1/projects/{projectId}/datasets", {
        params: {
          path: { projectId },
          query: cursor ? { limit: LIST_LIMIT, cursor } : { limit: LIST_LIMIT },
        },
      }),
    ),
  );
}

export function fetchDataset(api: ApiClient, projectId: string, datasetId: string): Promise<Dataset> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/datasets/{datasetId}", {
      params: { path: { projectId, datasetId } },
    }),
  );
}

export function fetchDatasetStats(
  api: ApiClient,
  projectId: string,
  datasetId: string,
): Promise<DatasetStats> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/datasets/{datasetId}/stats", {
      params: { path: { projectId, datasetId } },
    }),
  );
}

/** 202: the dataset row plus its materialise job. `seed` and `val_fraction` are required by the generated client. */
export function createDataset(
  api: ApiClient,
  projectId: string,
  body: DatasetCreate,
): Promise<DatasetWithJob> {
  return unwrap(api.POST("/api/v1/projects/{projectId}/datasets", { params: { path: { projectId } }, body }));
}

export async function deleteDataset(api: ApiClient, projectId: string, datasetId: string): Promise<void> {
  await unwrap<unknown>(
    api.DELETE("/api/v1/projects/{projectId}/datasets/{datasetId}", {
      params: { path: { projectId, datasetId } },
    }),
  );
}
