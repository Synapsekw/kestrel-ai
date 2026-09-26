import type { ApiClient, Project, components } from "@contract/client";
import { unwrap } from "./errors";

export type ProjectTypesUpdate = components["schemas"]["ProjectTypesUpdate"];

/** F §7.3: the ordered type list and per-project hotkey overrides; answers the updated project. */
export function saveProjectTypes(
  api: ApiClient,
  projectId: string,
  body: ProjectTypesUpdate,
): Promise<Project> {
  return unwrap(api.PUT("/api/v1/projects/{projectId}/types", { params: { path: { projectId } }, body }));
}
