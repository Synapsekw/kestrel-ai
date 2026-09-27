import { useEffect, useMemo } from "react";
import { useBackend } from "@/api/client";
import { attachSwipeClip, type ClipLayer } from "../compare/swipeClip";
import { useWorkspace, useWorkspaceStores } from "../context";
import { bumpWorkspaceData } from "../data/bump";
import type { SiteExtent } from "../view/siteGrid";
import { useGoneLayers } from "./goneLayers";
import type { LayerMountProps } from "./layerRegistry";
import { makeRasterLayer } from "./makeRasterLayer";
import { tileExtras } from "./rasterStyle";

/**
 * One placed base-map or elevation row on one map side (W1 mounts it per placement). The layer is
 * rebuilt only when its source changes; z, opacity and the swipe clip are property updates, and a
 * divider drag redraws through a store subscription without re-rendering (frame budget, M §13).
 */
export function RasterMount({ row, map, side, zIndex, opacity, style, projectId, frame }: LayerMountProps) {
  const { baseUrl, token } = useBackend();
  const { workspace } = useWorkspaceStores();
  const mode = useWorkspace((s) => s.mode);
  const gone = useGoneLayers((s) => s.gone.has(row.key));
  const markGone = useGoneLayers((s) => s.markGone);
  const kind = row.kind === "surface" ? "surface" : "map";
  const extras = tileExtras(kind, style, frame);
  const maxZoom = row.layer?.max_zoom ?? null;
  const footprint = (row.layer?.footprint_site as SiteExtent | null) ?? null;
  const sig = JSON.stringify([row.version, extras, maxZoom, footprint]);

  const layer = useMemo(
    () =>
      makeRasterLayer(
        {
          kind,
          id: row.id,
          version: row.version ?? "0",
          maxZoom,
          extent: footprint,
          extras,
        },
        {
          projection: map.getView().getProjection(),
          baseUrl,
          token,
          projectId,
          onGone: () => {
            markGone(row.key, row.name);
            bumpWorkspaceData(kind === "surface");
          },
        },
      ),
    // `sig` carries version, extras, max zoom and footprint: the only inputs that change the source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, baseUrl, token, projectId, row.key, sig],
  );

  useEffect(() => {
    if (gone) return;
    map.addLayer(layer);
    return () => {
      map.removeLayer(layer);
    };
  }, [map, layer, gone]);
  useEffect(() => () => layer.dispose(), [layer]);
  useEffect(() => layer.setZIndex(zIndex), [layer, zIndex]);
  useEffect(() => layer.setOpacity(opacity), [layer, opacity]);

  const clipSide = mode === "swipe" && side !== "both" ? side : null;
  useEffect(() => {
    if (!clipSide || gone) return;
    const detach = attachSwipeClip(layer as unknown as ClipLayer, clipSide, () => workspace.getState().swipe);
    const unsubscribe = workspace.subscribe((s, prev) => {
      if (s.swipe !== prev.swipe) map.render();
    });
    map.render();
    return () => {
      detach();
      unsubscribe();
      map.render();
    };
  }, [layer, clipSide, gone, map, workspace]);

  return null;
}
