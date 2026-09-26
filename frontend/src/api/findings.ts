import type { ApiClient, components, paths } from "@contract/client";
import { unwrap } from "./errors";
import type { Page } from "./paging";

type S = components["schemas"];
const P = "/api/v1/projects/{projectId}" as const;
type ListPath = paths["/api/v1/projects/{projectId}/findings"];
type ItemPath = paths["/api/v1/projects/{projectId}/findings/{findingId}"];
type BulkPath = paths["/api/v1/projects/{projectId}/findings/bulk"];

export type Finding = S["Finding"];
export type FindingAnchor = S["FindingAnchor"];
export type FindingStatus = Finding["status"];
export type FindingDetail = ItemPath["get"]["responses"][200]["content"]["application/json"];
export type FindingPatch = NonNullable<ItemPath["patch"]["requestBody"]>["content"]["application/json"];
export type FindingListQuery = NonNullable<ListPath["get"]["parameters"]["query"]>;
export type FindingComment = S["FindingComment"];
export type FindingAttachment = S["FindingAttachment"];
export type FindingSummary = S["FindingSummary"];
export type Activity = S["Activity"];
export type BulkSet = NonNullable<BulkPath["post"]["requestBody"]>["content"]["application/json"]["set"];
export type BulkResult = BulkPath["post"]["responses"][200]["content"]["application/json"];

/** F §8.3: `POST /findings/bulk` takes at most this many ids. */
export const FINDINGS_BULK_MAX = 1000;

/** F25: `listComments` pages at this size. */
export const COMMENTS_PAGE = 50;

export function listFindings(
  api: ApiClient,
  projectId: string,
  query: FindingListQuery,
): Promise<Page<Finding>> {
  return unwrap(api.GET(`${P}/findings`, { params: { path: { projectId }, query } }));
}

export function fetchFinding(api: ApiClient, projectId: string, findingId: string): Promise<FindingDetail> {
  return unwrap(api.GET(`${P}/findings/{findingId}`, { params: { path: { projectId, findingId } } }));
}

export function patchFinding(
  api: ApiClient,
  projectId: string,
  findingId: string,
  patch: FindingPatch,
): Promise<FindingDetail> {
  return unwrap(
    api.PATCH(`${P}/findings/{findingId}`, { params: { path: { projectId, findingId } }, body: patch }),
  );
}

export async function deleteFinding(api: ApiClient, projectId: string, findingId: string): Promise<void> {
  await unwrap(api.DELETE(`${P}/findings/{findingId}`, { params: { path: { projectId, findingId } } }));
}

export function bulkUpdateFindings(
  api: ApiClient,
  projectId: string,
  ids: string[],
  set: BulkSet,
): Promise<BulkResult> {
  return unwrap(api.POST(`${P}/findings/bulk`, { params: { path: { projectId } }, body: { ids, set } }));
}

export function fetchFindingSummary(api: ApiClient, projectId: string): Promise<FindingSummary> {
  return unwrap(api.GET(`${P}/findings/summary`, { params: { path: { projectId } } }));
}

export function listComments(
  api: ApiClient,
  projectId: string,
  findingId: string,
  cursor?: string,
): Promise<Page<FindingComment>> {
  return unwrap(
    api.GET(`${P}/findings/{findingId}/comments`, {
      params: {
        path: { projectId, findingId },
        query: { limit: COMMENTS_PAGE, ...(cursor ? { cursor } : {}) },
      },
    }),
  );
}

export function addComment(
  api: ApiClient,
  projectId: string,
  findingId: string,
  text: string,
): Promise<FindingComment> {
  return unwrap(
    api.POST(`${P}/findings/{findingId}/comments`, {
      params: { path: { projectId, findingId } },
      body: { text },
    }),
  );
}

export function editComment(
  api: ApiClient,
  projectId: string,
  findingId: string,
  commentId: string,
  text: string,
): Promise<FindingComment> {
  return unwrap(
    api.PATCH(`${P}/findings/{findingId}/comments/{commentId}`, {
      params: { path: { projectId, findingId, commentId } },
      body: { text },
    }),
  );
}

export async function deleteComment(
  api: ApiClient,
  projectId: string,
  findingId: string,
  commentId: string,
): Promise<void> {
  await unwrap(
    api.DELETE(`${P}/findings/{findingId}/comments/{commentId}`, {
      params: { path: { projectId, findingId, commentId } },
    }),
  );
}

export async function listAttachments(
  api: ApiClient,
  projectId: string,
  findingId: string,
): Promise<FindingAttachment[]> {
  const r = await unwrap(
    api.GET(`${P}/findings/{findingId}/attachments`, { params: { path: { projectId, findingId } } }),
  );
  return r.items;
}

/** `path` is a local file chosen in the Tauri dialog; the backend validates and copies it (<= 50 MB). */
export function addAttachment(
  api: ApiClient,
  projectId: string,
  findingId: string,
  path: string,
): Promise<FindingAttachment> {
  return unwrap(
    api.POST(`${P}/findings/{findingId}/attachments`, {
      params: { path: { projectId, findingId } },
      body: { path },
    }),
  );
}

export async function deleteAttachment(
  api: ApiClient,
  projectId: string,
  findingId: string,
  attachmentId: string,
): Promise<void> {
  await unwrap(
    api.DELETE(`${P}/findings/{findingId}/attachments/{attachmentId}`, {
      params: { path: { projectId, findingId, attachmentId } },
    }),
  );
}

export function listActivity(
  api: ApiClient,
  projectId: string,
  query: { subject_id?: string; limit?: number; cursor?: string },
): Promise<Page<Activity>> {
  return unwrap(api.GET(`${P}/activity`, { params: { path: { projectId }, query } }));
}

/** `<img src>` URLs carry the token in the query, as today's image thumbnails do. */
function tokenUrl(baseUrl: string, token: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}?token=${encodeURIComponent(token)}`;
}

export function findingThumbnailUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  findingId: string,
): string {
  return tokenUrl(baseUrl, token, `/api/v1/projects/${projectId}/findings/${findingId}/thumbnail`);
}

export function attachmentThumbnailUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  findingId: string,
  attachmentId: string,
): string {
  return tokenUrl(
    baseUrl,
    token,
    `/api/v1/projects/${projectId}/findings/${findingId}/attachments/${attachmentId}/thumbnail`,
  );
}

export function attachmentFileUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  findingId: string,
  attachmentId: string,
): string {
  return tokenUrl(
    baseUrl,
    token,
    `/api/v1/projects/${projectId}/findings/${findingId}/attachments/${attachmentId}/file`,
  );
}
