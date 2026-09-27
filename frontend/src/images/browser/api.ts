import type { ApiClient, Image as ImageRow, paths } from "@contract/client";
import { unwrap } from "@/api/errors";

type IndexOp = paths["/api/v1/projects/{projectId}/images/index"]["get"];
/** Spec §7.1 / §14: the columnar index query (I-C0's contract). */
export type ImageIndexQuery = NonNullable<IndexOp["parameters"]["query"]>;
export type ImageIndexResponse = IndexOp["responses"][200]["content"]["application/json"];

/** Spec §15: details are read by id for the visible window only, at most 200 per request. */
export const DETAILS_BATCH = 200;

export function fetchImageIndex(
  api: ApiClient,
  projectId: string,
  query: ImageIndexQuery,
): Promise<ImageIndexResponse> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/images/index", { params: { path: { projectId }, query } }),
  );
}

export async function fetchImageDetails(
  api: ApiClient,
  projectId: string,
  ids: readonly string[],
): Promise<ImageRow[]> {
  if (ids.length === 0) return [];
  if (ids.length > DETAILS_BATCH) throw new Error(`at most ${DETAILS_BATCH} ids per details request`);
  const page = await unwrap(
    api.GET("/api/v1/projects/{projectId}/images", {
      params: { path: { projectId }, query: { ids: ids.join(","), limit: DETAILS_BATCH } },
    }),
  );
  return page.items;
}
