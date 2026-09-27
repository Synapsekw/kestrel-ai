import type { ApiClient, paths } from "@contract/client";
import { unwrap } from "@/api/errors";

type SampleOp = paths["/api/v1/projects/{projectId}/map-workspace/sample"]["post"];
export type SampleBody = NonNullable<SampleOp["requestBody"]>["content"]["application/json"];
export type SampleResult = SampleOp["responses"][200]["content"]["application/json"];

/** M §12 `sampleInFrame`: `{x, y, surface_ids}` in site coordinates → z per surface. */
export function sampleInFrame(
  api: ApiClient,
  projectId: string,
  body: SampleBody,
  signal?: AbortSignal,
): Promise<SampleResult> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/map-workspace/sample", {
      params: { path: { projectId } },
      body,
      signal,
    }),
  );
}
