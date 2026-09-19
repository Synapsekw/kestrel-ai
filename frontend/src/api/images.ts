import type { ApiClient, ImagePage, Image as ImageRow, components, paths } from "@contract/client";
import { unwrap } from "./errors";

export type ListImagesQuery = NonNullable<
  paths["/api/v1/projects/{projectId}/images"]["get"]["parameters"]["query"]
>;
export type PreannotateResult = components["schemas"]["PreannotateResult"];

export const IMAGE_PAGE_SIZE = 200;

/** Spec section 6 screen 4: images with unreviewed proposals, highest proposal confidence first. */
export const REVIEW_QUEUE_QUERY: ListImagesQuery = {
  has_pending: true,
  sort: "max_pending_confidence",
  order: "desc",
};

export function fetchImagePage(
  api: ApiClient,
  projectId: string,
  query: ListImagesQuery,
): Promise<ImagePage> {
  return unwrap(api.GET("/api/v1/projects/{projectId}/images", { params: { path: { projectId }, query } }));
}

export function fetchImage(api: ApiClient, projectId: string, imageId: string): Promise<ImageRow> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/images/{imageId}", { params: { path: { projectId, imageId } } }),
  );
}

export async function bulkDeleteImages(
  api: ApiClient,
  projectId: string,
  imageIds: string[],
): Promise<number> {
  const r = await unwrap(
    api.POST("/api/v1/projects/{projectId}/images/bulk-delete", {
      params: { path: { projectId } },
      body: { image_ids: imageIds },
    }),
  );
  return r.deleted;
}

export type BulkMarkEmptyResult = components["schemas"]["BulkMarkEmptyResult"];

/** "No machinery on this image": marks it empty (or undoes the mark) - E4. */
export function setMarkedEmpty(
  api: ApiClient,
  projectId: string,
  imageId: string,
  value: boolean,
): Promise<ImageRow> {
  return unwrap(
    api.PATCH("/api/v1/projects/{projectId}/images/{imageId}", {
      params: { path: { projectId, imageId } },
      body: { marked_empty: value },
    }),
  );
}

export function bulkMarkEmpty(
  api: ApiClient,
  projectId: string,
  imageIds: string[],
  value: boolean,
): Promise<BulkMarkEmptyResult> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/images/bulk-mark-empty", {
      params: { path: { projectId } },
      body: { image_ids: imageIds, marked_empty: value },
    }),
  );
}

/** No body: the backend uses the project's pre-annotation model and its defaults. */
export function preannotateImage(
  api: ApiClient,
  projectId: string,
  imageId: string,
): Promise<PreannotateResult> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/images/{imageId}/preannotate", {
      params: { path: { projectId, imageId } },
    }),
  );
}
