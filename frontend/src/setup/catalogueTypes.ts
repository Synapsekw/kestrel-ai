import type { ApiClient, components } from "@contract/client";
import { unwrap } from "@/api/errors";

export type CatalogueType = components["schemas"]["CatalogueType"];

/** The API's page maximum: one bounded read of the catalogue for the "Types to start with" picker. */
const CATALOGUE_PAGE_MAX = 1000;

/** Non-archived catalogue types, defects first, then by name (F §7.2: archived types are not offered). */
export async function fetchPickableTypes(api: ApiClient): Promise<CatalogueType[]> {
  const r = await unwrap(
    api.GET("/api/v1/catalogue/types", { params: { query: { limit: CATALOGUE_PAGE_MAX } } }),
  );
  // The server already leaves archived types out by default; the filter guards against a change there.
  return r.items
    .filter((t) => !t.archived)
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "defect" ? -1 : 1));
}
