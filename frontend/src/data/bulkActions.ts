import type { ApiClient, Job } from "@contract/client";
import { unwrap } from "@/api/errors";
import { bulkDeleteImages } from "@/api/images";

export interface DatasetOptions {
  name: string;
  split_method: "by_group" | "by_tile" | "random";
  val_fraction: number;
}

/** "Run model on selected": a local-model query run with the project's pre-annotation model (501 until S4). */
export async function runModelOnImages(
  api: ApiClient,
  projectId: string,
  imageIds: string[],
  modelId: string,
): Promise<Job> {
  const r = await unwrap(
    api.POST("/api/v1/projects/{projectId}/query-runs", {
      params: { path: { projectId } },
      // `conf` carries the contract default explicitly: the generated client marks it required.
      body: { kind: "local_model", model_id: modelId, image_ids: imageIds, conf: 0.25 },
    }),
  );
  return r.job;
}

/** "Add to dataset": freeze the selection into a new dataset (501 until S1). */
export async function addImagesToDataset(
  api: ApiClient,
  projectId: string,
  imageIds: string[],
  opts: DatasetOptions,
): Promise<Job> {
  const r = await unwrap(
    api.POST("/api/v1/projects/{projectId}/datasets", {
      params: { path: { projectId } },
      body: {
        name: opts.name,
        split_method: opts.split_method,
        val_fraction: opts.val_fraction,
        // `seed` carries the contract default explicitly: the generated client marks it required.
        seed: 42,
        image_ids: imageIds,
      },
    }),
  );
  return r.job;
}

export function deleteImages(api: ApiClient, projectId: string, imageIds: string[]): Promise<number> {
  return bulkDeleteImages(api, projectId, imageIds);
}
