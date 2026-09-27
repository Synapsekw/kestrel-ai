import type { ApiClient } from "@contract/client";
import { bulkDeleteImages, bulkMarkEmpty, type BulkMarkEmptyResult } from "@/api/images";

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

/** "Unmark empty": undo the mark on the selected images. Never refused; nothing to reject. */
export function unmarkImagesEmpty(
  api: ApiClient,
  projectId: string,
  imageIds: string[],
): Promise<BulkMarkEmptyResult> {
  return bulkMarkEmpty(api, projectId, imageIds, false);
}
