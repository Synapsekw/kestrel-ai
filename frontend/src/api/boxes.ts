import type { ApiClient, Box, BoxCreate, BoxUpdate, components } from "@contract/client";
import { unwrap } from "./errors";

/** `accept` / `reject` decide a proposal; `unreview` puts a reviewed proposal back (undo). */
export type ReviewAction = components["schemas"]["BoxReview"]["action"];

export async function fetchBoxes(api: ApiClient, projectId: string, imageId: string): Promise<Box[]> {
  const r = await unwrap(
    api.GET("/api/v1/projects/{projectId}/images/{imageId}/boxes", {
      params: { path: { projectId, imageId } },
    }),
  );
  return r.items;
}

export function createBox(api: ApiClient, projectId: string, imageId: string, body: BoxCreate): Promise<Box> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/images/{imageId}/boxes", {
      params: { path: { projectId, imageId } },
      body,
    }),
  );
}

export function updateBox(api: ApiClient, projectId: string, boxId: string, body: BoxUpdate): Promise<Box> {
  return unwrap(
    api.PATCH("/api/v1/projects/{projectId}/boxes/{boxId}", { params: { path: { projectId, boxId } }, body }),
  );
}

export async function deleteBox(api: ApiClient, projectId: string, boxId: string): Promise<void> {
  await unwrap<unknown>(
    api.DELETE("/api/v1/projects/{projectId}/boxes/{boxId}", { params: { path: { projectId, boxId } } }),
  );
}

export async function reviewBoxes(
  api: ApiClient,
  projectId: string,
  boxIds: string[],
  action: ReviewAction,
): Promise<number> {
  const r = await unwrap(
    api.POST("/api/v1/projects/{projectId}/boxes/review", {
      params: { path: { projectId } },
      body: { box_ids: boxIds, action },
    }),
  );
  return r.updated;
}
