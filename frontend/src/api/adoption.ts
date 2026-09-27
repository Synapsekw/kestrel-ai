import type { ApiClient, Job, components } from "@contract/client";
import { unwrap } from "./errors";

export type AdoptionStatus = components["schemas"]["AdoptionStatus"];

const P = "/api/v1/projects/{projectId}" as const;

/** How far this project's old models are on their way into the library. */
export function fetchAdoption(api: ApiClient, projectId: string): Promise<AdoptionStatus> {
  return unwrap(api.GET(`${P}/adoption`, { params: { path: { projectId } } }));
}

/** Forgets the missing and failed models and starts the adoption job again; 409 while one runs. */
export async function retryAdoption(api: ApiClient, projectId: string): Promise<Job> {
  return (await unwrap(api.POST(`${P}/adoption/retry`, { params: { path: { projectId } } }))).job;
}
