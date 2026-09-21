import type { ApiClient, Job, Model, StarterModel, StarterModelKey } from "@contract/client";
import { unwrap } from "./errors";

/** The bounded catalogue of compatible detection weights; always one page. */
export async function listStarterModels(api: ApiClient): Promise<StarterModel[]> {
  const page = await unwrap(api.GET("/api/v1/starter-models"));
  return page.items;
}

export function importStarterModel(
  api: ApiClient,
  projectId: string,
  key: StarterModelKey,
  name?: string,
): Promise<Model> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/models/import-starter", {
      params: { path: { projectId } },
      body: name ? { key, name } : { key },
    }),
  );
}

/** Downloads only the selected weights and imports them in a cancellable background job. */
export async function acquireStarterModel(
  api: ApiClient,
  projectId: string,
  key: StarterModelKey,
  name?: string,
): Promise<Job> {
  const result = await unwrap(
    api.POST("/api/v1/projects/{projectId}/models/acquire-starter", {
      params: { path: { projectId } },
      body: name ? { key, name } : { key },
    }),
  );
  return result.job;
}
