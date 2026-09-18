import type { ApiClient } from "@contract/client";
import { createDataset, type DatasetWithJob, type SplitMethod } from "@/api/datasets";
import { bulkDeleteImages } from "@/api/images";

export interface DatasetOptions {
  name: string;
  split_method: SplitMethod;
  val_fraction: number;
  seed: number;
}

/** "Add to dataset": freeze the selection into a new dataset; the materialise job comes back with it. */
export function addImagesToDataset(
  api: ApiClient,
  projectId: string,
  imageIds: string[],
  opts: DatasetOptions,
): Promise<DatasetWithJob> {
  return createDataset(api, projectId, { ...opts, image_ids: imageIds });
}

export function deleteImages(api: ApiClient, projectId: string, imageIds: string[]): Promise<number> {
  return bulkDeleteImages(api, projectId, imageIds);
}
