import type { ApiClient, StarterModel } from "@contract/client";
import { unwrap } from "./errors";

/** The bounded catalogue of compatible detection weights; always one page. Adding one is `acquireStarter` in `api/library`. */
export async function listStarterModels(api: ApiClient): Promise<StarterModel[]> {
  const page = await unwrap(api.GET("/api/v1/starter-models"));
  return page.items;
}
