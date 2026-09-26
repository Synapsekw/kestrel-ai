import type { ApiClient, components } from "@contract/client";
import { unwrap } from "./errors";
import type { Page } from "./paging";

export type DataItem = components["schemas"]["DataItem"];
export type DataItemType = components["schemas"]["DataItemType"];

/** F §6.3: the union of every data type, keyset-paged. */
export function listDataItems(
  api: ApiClient,
  projectId: string,
  query: { type?: DataItemType[]; limit?: number; cursor?: string },
): Promise<Page<DataItem>> {
  return unwrap(api.GET("/api/v1/projects/{projectId}/data", { params: { path: { projectId }, query } }));
}
