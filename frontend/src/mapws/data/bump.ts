import { useChangesStore } from "@/store/changes";

/**
 * W2-10: W2's own writes (and a 404 tile) make W1's layers and surveys re-read. Lives on its own so
 * RasterMount and the dialogs can import it without the `useRasterLayers → map.layer → RasterMount`
 * cycle (recon §1 Task 4).
 */
export function bumpWorkspaceData(surfaces = false): void {
  useChangesStore.setState((s) => ({
    mapWorkspaceRevision: s.mapWorkspaceRevision + 1,
    ...(surfaces ? { surfacesRevision: s.surfacesRevision + 1 } : {}),
  }));
}
