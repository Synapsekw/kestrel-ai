import type { ApiClient, components } from "@contract/client";
import { unwrap } from "@/api/errors";
import type { Survey, WorkspaceLayer } from "./types";

/** The workspace reads W1 makes (spec §12); all bounded: one row per map, surface or drawing. */
const P = "/api/v1/projects/{projectId}" as const;
export type MapWorkspace = components["schemas"]["MapWorkspace"];

export function fetchWorkspace(api: ApiClient, projectId: string): Promise<MapWorkspace> {
  return unwrap(api.GET(`${P}/map-workspace`, { params: { path: { projectId } } }));
}

export async function listWorkspaceLayers(api: ApiClient, projectId: string): Promise<WorkspaceLayer[]> {
  return (await unwrap(api.GET(`${P}/map-workspace/layers`, { params: { path: { projectId } } }))).items;
}

export async function listWorkspaceSurveys(api: ApiClient, projectId: string): Promise<Survey[]> {
  return (
    await unwrap(
      api.GET(`${P}/map-workspace/surveys`, {
        params: { path: { projectId } },
      }),
    )
  ).items;
}

/** `PUT /map-workspace {state}`; the planned surveys stay as they are (absent in the body). */
export async function putWorkspaceState(
  api: ApiClient,
  projectId: string,
  state: Record<string, unknown>,
): Promise<void> {
  await unwrap(
    api.PUT(`${P}/map-workspace`, {
      params: { path: { projectId } },
      body: { state },
    }),
  );
}
