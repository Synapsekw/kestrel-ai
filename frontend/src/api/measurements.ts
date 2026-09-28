import type { ApiClient, paths } from "@contract/client";
import { unwrap } from "./errors";

type ListOp = paths["/api/v1/projects/{projectId}/measurements"]["get"];
export type MeasurementListQuery = NonNullable<ListOp["parameters"]["query"]>;
export type MeasurementPage = ListOp["responses"][200]["content"]["application/json"];
/** One row of M's union (M §12): a cloud, volume or map measurement. */
export type MeasurementItem = MeasurementPage["items"][number];

export function listMeasurements(
  api: ApiClient,
  projectId: string,
  query: MeasurementListQuery,
): Promise<MeasurementPage> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/measurements", {
      params: { path: { projectId }, query },
    }),
  );
}
