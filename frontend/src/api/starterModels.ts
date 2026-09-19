import type { ApiClient, Model, StarterModel, StarterModelKey } from "@contract/client";
import { unwrap } from "./errors";

/** The fixed catalogue of starter weights bundled with the app; always one page. */
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
