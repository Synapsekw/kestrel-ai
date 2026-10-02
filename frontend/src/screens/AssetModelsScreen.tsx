import { AssetModelWorkspace } from "@/assetmodels/workspace/AssetModelWorkspace";

/** The project's Asset models route body: `/p/:projectId/models/:modelId?`. */
export function AssetModelsScreen() {
  return <AssetModelWorkspace />;
}
