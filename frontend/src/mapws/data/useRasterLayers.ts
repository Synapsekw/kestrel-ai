import { useMemo, useState } from "react";
import { useWorkspace } from "../context";
import { useGoneLayers } from "../layers/goneLayers";
import type { LayerKind } from "../layers/layerRegistry";
import mapKind from "../layers/map.layer";
import { placeLayers, type Placement } from "../layers/placement";
import { baseMapRows, elevationRows } from "../layers/rasterRows";
import surfaceKind from "../layers/surface.layer";
import type { WorkspaceLayer } from "../types";
import { useWorkspaceLayers } from "./useWorkspaceLayers";

export { bumpWorkspaceData } from "./bump";

export const RASTER_KINDS: ReadonlyMap<string, LayerKind> = new Map([
  [mapKind.id, mapKind],
  [surfaceKind.id, surfaceKind],
]);

/**
 * The map and surface layers of W1's one layers read (Budget). Null only before the first load: W1
 * flips `loading` on every re-read (self-save echoes included) and keeps the last layers meanwhile,
 * so a later re-read keeps returning them instead of flashing "no layers".
 */
export function useRasterLayers(): WorkspaceLayer[] | null {
  const { layers, loading } = useWorkspaceLayers();
  const [loaded, setLoaded] = useState(!loading);
  if (!loading && !loaded) setLoaded(true);
  const waiting = loading && !loaded;
  return useMemo(
    () => (waiting ? null : layers.filter((l) => l.kind === "map" || l.kind === "surface")),
    [layers, waiting],
  );
}

/** W1's placements of W2's rows under the current compare state (labels, notes). */
export function useRasterPlacements(): Placement[] {
  const layers = useRasterLayers();
  const state = useWorkspace((s) => s.layerState);
  const order = useWorkspace((s) => s.order);
  const mode = useWorkspace((s) => s.mode);
  const l = useWorkspace((s) => s.l);
  const r = useWorkspace((s) => s.r);
  const blend = useWorkspace((s) => s.blend);
  const gone = useGoneLayers((s) => s.gone);
  return useMemo(() => {
    const ctx = { layers: layers ?? [] };
    const rows = [...baseMapRows(ctx), ...elevationRows(ctx)].filter((row) => !gone.has(row.key));
    return placeLayers({
      rows,
      state,
      order,
      mode,
      l,
      r,
      blend,
      kinds: RASTER_KINDS,
    }).placed;
  }, [layers, state, order, mode, l, r, blend, gone]);
}
