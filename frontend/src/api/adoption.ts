import type { ApiClient, Job, Project, components } from "@contract/client";
import { unwrap } from "./errors";
import { collectPages } from "./paging";

export type AdoptionStatus = components["schemas"]["AdoptionStatus"];

const P = "/api/v1/projects/{projectId}" as const;

/** How far this training project's old models are on their way into the library. */
export function fetchAdoption(api: ApiClient, projectId: string): Promise<AdoptionStatus> {
  return unwrap(api.GET(`${P}/adoption`, { params: { path: { projectId } } }));
}

/** Forgets the missing and failed models and starts the adoption job again; 409 while one runs. */
export async function retryAdoption(api: ApiClient, projectId: string): Promise<Job> {
  return (await unwrap(api.POST(`${P}/adoption/retry`, { params: { path: { projectId } } }))).job;
}

/** Copies a past map into a detection project. The returned job lives in the target project. */
export async function moveMap(
  api: ApiClient,
  projectId: string,
  mapId: string,
  targetProjectId: string,
): Promise<Job> {
  return (
    await unwrap(
      api.POST(`${P}/maps/{mapId}/move`, {
        params: { path: { projectId, mapId } },
        body: { target_project_id: targetProjectId },
      }),
    )
  ).job;
}

/** The recent projects that are detection projects (the recent list holds at most a few dozen). */
export async function fetchDetectionProjects(api: ApiClient): Promise<Project[]> {
  const all = await collectPages((cursor) =>
    unwrap(api.GET("/api/v1/projects", { params: { query: cursor ? { cursor } : {} } })),
  );
  return all.filter((p) => p.kind === "detect");
}

/** A new detection project; it starts without classes, its first run fills them in. */
export function createDetectionProject(api: ApiClient, name: string, folder: string): Promise<Project> {
  return unwrap(api.POST("/api/v1/projects", { body: { name, folder, kind: "detect", classes: [] } }));
}
