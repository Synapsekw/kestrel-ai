import type { components } from "@contract/client";

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
