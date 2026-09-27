import type { ApiClient, Job, paths } from "@contract/client";
import { unwrap } from "@/api/errors";

const P = "/api/v1/projects/{projectId}" as const;
type Body<T> = T extends { requestBody?: { content: { "application/json": infer B } } } ? B : never;

type DetectOp = paths["/api/v1/projects/{projectId}/images/{imageId}/detect"]["post"];
type BatchOp = paths["/api/v1/projects/{projectId}/images/detect-batch"]["post"];
type PrepareOp = paths["/api/v1/projects/{projectId}/images/{imageId}/segment/prepare"]["post"];
type SegmentOp = paths["/api/v1/projects/{projectId}/images/{imageId}/segment"]["post"];
type AssistListOp = paths["/api/v1/library/assist-models"]["get"];
type ReviewOp = paths["/api/v1/projects/{projectId}/boxes/review"]["post"];

export type DetectRequest = Body<DetectOp>;
export type DetectResult = DetectOp["responses"][200]["content"]["application/json"];
export type DetectBatchRequest = Body<BatchOp>;
export type DetectBatchResult = BatchOp["responses"][202]["content"]["application/json"];
export type SegmentCrop = Body<PrepareOp>["crop"];
export type SegmentPrepared = PrepareOp["responses"][200]["content"]["application/json"];
export type SegmentPoint = Body<SegmentOp>["points"][number];
export type SegmentResult = SegmentOp["responses"][200]["content"]["application/json"];
export type AssistModel = AssistListOp["responses"][200]["content"]["application/json"]["items"][number];
export type AssistKey = AssistModel["key"];
export type ReviewResult = ReviewOp["responses"][200]["content"]["application/json"];

/** §11.2: synchronous, bounded by one image (≤ 64 tiles, GPU with a 2 s wait, else CPU). */
export function detectImage(
  api: ApiClient,
  projectId: string,
  imageId: string,
  body: DetectRequest,
): Promise<DetectResult> {
  return unwrap(api.POST(`${P}/images/{imageId}/detect`, { params: { path: { projectId, imageId } }, body }));
}

/** §11.3: a QueryRun plus the queued `infer` job. */
export function detectBatch(
  api: ApiClient,
  projectId: string,
  body: DetectBatchRequest,
): Promise<DetectBatchResult> {
  return unwrap(api.POST(`${P}/images/detect-batch`, { params: { path: { projectId } }, body }));
}

export function prepareSegment(
  api: ApiClient,
  projectId: string,
  imageId: string,
  crop: SegmentCrop,
): Promise<SegmentPrepared> {
  return unwrap(
    api.POST(`${P}/images/{imageId}/segment/prepare`, {
      params: { path: { projectId, imageId } },
      body: { crop },
    }),
  );
}

export function segment(
  api: ApiClient,
  projectId: string,
  imageId: string,
  crop: SegmentCrop,
  points: SegmentPoint[],
): Promise<SegmentResult> {
  return unwrap(
    api.POST(`${P}/images/{imageId}/segment`, {
      params: { path: { projectId, imageId } },
      body: { crop, points },
    }),
  );
}

/** One page by contract (`next_cursor` is always null). */
export async function listAssistModels(api: ApiClient): Promise<AssistModel[]> {
  return (await unwrap(api.GET("/api/v1/library/assist-models"))).items;
}

export async function acquireAssistModel(api: ApiClient, key: AssistKey): Promise<Job> {
  return (
    await unwrap(api.POST("/api/v1/library/assist-models/{key}/acquire", { params: { path: { key } } }))
  ).job;
}

export async function importAssistModel(api: ApiClient, key: AssistKey, path: string): Promise<Job> {
  return (
    await unwrap(
      api.POST("/api/v1/library/assist-models/{key}/import", { params: { path: { key } }, body: { path } }),
    )
  ).job;
}
