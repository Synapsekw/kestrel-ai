import type { ApiClient, Schemas } from "@contract/client";
import { unwrap } from "./errors";

// The item list and read live in siteScene.ts (ruling R-S3-13); this is the S3 import surface.
export { ITEMS_PAGE, getAssetItem, listAssetItems } from "./siteScene";
export type { AssetItem, AssetItemPage, AssetItemRow, ItemFilters as ItemQuery } from "./siteScene";

export type CatalogueEntry = Schemas["AssetBuilderType"];
export type SiteModelPackage = Schemas["SiteModelPackageList"]["items"][number];

const CATALOGUE = "/api/v1/asset-models/catalogue" as const;
const PACKAGES = "/api/v1/projects/{projectId}/asset-models/{assetModelId}/runs/{runId}/packages" as const;

/** The live builder catalogue (`getAssetModelCatalogue`): types, families, docs and param schemas. */
export async function getCatalogue(api: ApiClient): Promise<CatalogueEntry[]> {
  return (await unwrap(api.GET(CATALOGUE))).types;
}

/** A plant run's work packages (`listAssetModelRunPackages`, up to 64). */
export async function listRunPackages(
  api: ApiClient,
  projectId: string,
  assetModelId: string,
  runId: string,
): Promise<SiteModelPackage[]> {
  return (await unwrap(api.GET(PACKAGES, { params: { path: { projectId, assetModelId, runId } } }))).items;
}
