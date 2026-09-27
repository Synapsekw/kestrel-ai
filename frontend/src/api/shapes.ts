import type { ApiClient, Box, BoxCreate, BoxUpdate, components } from "@contract/client";
import { unwrap } from "./errors";

type S = components["schemas"];

/** One annotation row of any shape (spec §8.1): box | rbox | polygon | point. */
export type Shape = S["Box"]["shape"];
/** `GET /images/{imageId}`: the Image plus camera, footprint and footprint kind (spec §14). */
export type ImageDetail = S["ImageDetail"];
export type ImageCamera = S["ImageCamera"];
/** What create and update answer (C0 ruling 1): the Box plus `repaired` and `finding_id`. */
export type BoxWriteResult = S["BoxWriteResult"];
export type ImageMeasurement = S["ImageMeasurement"];
export type ImageMeasurementCreate = S["ImageMeasurementCreate"];
export type BoxReviewResult = S["BoxReviewResult"];
export type ShapeReviewAction = S["BoxReview"]["action"];

export function fetchImageDetail(api: ApiClient, projectId: string, imageId: string): Promise<ImageDetail> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/images/{imageId}", { params: { path: { projectId, imageId } } }),
  ) as Promise<ImageDetail>;
}

export function createShape(
  api: ApiClient,
  projectId: string,
  imageId: string,
  body: BoxCreate,
): Promise<BoxWriteResult> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/images/{imageId}/boxes", {
      params: { path: { projectId, imageId } },
      body,
    }),
  );
}

export function updateShape(
  api: ApiClient,
  projectId: string,
  boxId: string,
  body: BoxUpdate,
  opts: { confirmFindingDelete?: boolean } = {},
): Promise<BoxWriteResult> {
  return unwrap(
    api.PATCH("/api/v1/projects/{projectId}/boxes/{boxId}", {
      params: {
        path: { projectId, boxId },
        query: opts.confirmFindingDelete ? { confirm_finding_delete: true } : undefined,
      },
      body,
    }),
  );
}

export function reviewShapes(
  api: ApiClient,
  projectId: string,
  boxIds: string[],
  action: ShapeReviewAction,
): Promise<BoxReviewResult> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/boxes/review", {
      params: { path: { projectId } },
      body: { box_ids: boxIds, action },
    }),
  );
}

export async function listImageMeasurements(
  api: ApiClient,
  projectId: string,
  imageId: string,
): Promise<ImageMeasurement[]> {
  const r = await unwrap(
    api.GET("/api/v1/projects/{projectId}/images/{imageId}/measurements", {
      params: { path: { projectId, imageId } },
    }),
  );
  return r.items;
}

export function createImageMeasurement(
  api: ApiClient,
  projectId: string,
  imageId: string,
  body: ImageMeasurementCreate,
): Promise<ImageMeasurement> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/images/{imageId}/measurements", {
      params: { path: { projectId, imageId } },
      body,
    }),
  );
}

export async function deleteImageMeasurement(
  api: ApiClient,
  projectId: string,
  measurementId: string,
): Promise<void> {
  await unwrap<unknown>(
    api.DELETE("/api/v1/projects/{projectId}/image-measurements/{imageMeasurementId}", {
      params: { path: { projectId, imageMeasurementId: measurementId } },
    }),
  );
}

/** The create body that brings `box` back (undo of a delete, duplicate): only its shape's fields. */
export function bodyOf(box: Box): BoxCreate {
  if (box.shape === "polygon") {
    const body: BoxCreate = { class_id: box.class_id, shape: "polygon", points: box.points ?? [] };
    if (box.assist) body.assist = box.assist;
    return body;
  }
  if (box.shape === "point") return { class_id: box.class_id, shape: "point", x: box.x, y: box.y };
  return {
    class_id: box.class_id,
    shape: box.shape,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    angle: box.angle,
  };
}
