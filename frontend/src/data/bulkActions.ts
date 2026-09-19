import type { ApiClient } from "@contract/client";
import { createDataset, type DatasetWithJob, type SplitMethod } from "@/api/datasets";
import { bulkDeleteImages, bulkMarkEmpty, type BulkMarkEmptyResult } from "@/api/images";

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

/** "Mark as empty": no machinery on the selected images (E4). Ground-truth images are skipped. */
export function markImagesEmpty(
  api: ApiClient,
  projectId: string,
  imageIds: string[],
): Promise<BulkMarkEmptyResult> {
  return bulkMarkEmpty(api, projectId, imageIds, true);
}
