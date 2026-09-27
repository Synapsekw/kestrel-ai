import { useEffect, useMemo, useRef } from "react";
import type TileLayer from "ol/layer/Tile";
import type TileImage from "ol/source/TileImage";
import { useBackend } from "@/api/client";
import { attachSwipeClip, type ClipLayer } from "../compare/swipeClip";
import { useWorkspace, useWorkspaceStores } from "../context";
import { bumpWorkspaceData } from "../data/bump";
import type { SiteExtent } from "../view/siteGrid";
import { useGoneLayers } from "./goneLayers";
import type { LayerMountProps } from "./layerRegistry";
import { makeRasterLayer, type RasterSource } from "./makeRasterLayer";
import { tileExtras } from "./rasterStyle";

/** A footprint is an extent only when it is four finite numbers; anything else draws unclamped. */
function extentOf(fp: readonly number[] | null | undefined): SiteExtent | null {
  return Array.isArray(fp) && fp.length === 4 && fp.every(Number.isFinite) ? (fp as SiteExtent) : null;
}

/**
 * One placed base-map or elevation row on one map side (W1 mounts it per placement). The layer is
 * built, added, removed and disposed inside one effect (StrictMode-safe: a re-run effect builds a
 * fresh layer, never re-adds a disposed one) and only when its source changes; z, opacity and the
 * swipe clip are property updates, and a divider drag redraws through a store subscription without
 * re-rendering (frame budget, M §13).
 */
export function RasterMount({ row, map, side, zIndex, opacity, style, projectId, frame }: LayerMountProps) {
  const { baseUrl, token } = useBackend();
  const { workspace } = useWorkspaceStores();
  const mode = useWorkspace((s) => s.mode);
  const gone = useGoneLayers((s) => s.gone.has(row.key));
  const kind = row.kind === "surface" ? "surface" : "map";
  const extras = tileExtras(kind, style, frame);
  const maxZoom = row.layer?.max_zoom ?? null;
  const extent = extentOf(row.layer?.footprint_site);
  const sig = JSON.stringify([row.version, extras, maxZoom, extent]);

  // What the tile source is built from; a pure value, so StrictMode's double memo call is harmless.
  const src = useMemo<RasterSource>(
    () => ({ kind, id: row.id, version: row.version ?? "0", maxZoom, extent, extras }),
    // `sig` carries version, extras, max zoom and extent: the only inputs that change the source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, row.id, sig],
  );

  // The toast names the row as it reads now, without rebuilding the layer on a rename.
  const nameRef = useRef(row.name);
  useEffect(() => {
    nameRef.current = row.name;
  }, [row.name]);

  const layerRef = useRef<TileLayer<TileImage> | null>(null);
  const rowKey = row.key;
  useEffect(() => {
    if (gone) return;
    const layer = makeRasterLayer(src, {
      projection: map.getView().getProjection(),
      baseUrl,
      token,
      projectId,
      // Every 404/410 tile calls this; only the first drops the row and makes W1 re-read (W2-9).
      onGone: () => {
        const g = useGoneLayers.getState();
        if (g.gone.has(rowKey)) return;
        g.markGone(rowKey, nameRef.current);
        bumpWorkspaceData(src.kind === "surface");
      },
    });
    layerRef.current = layer;
    map.addLayer(layer);
    return () => {
      map.removeLayer(layer);
      layer.dispose();
      if (layerRef.current === layer) layerRef.current = null;
    };
  }, [map, src, baseUrl, token, projectId, rowKey, gone]);

  // Declared after the build effect, and keyed by its inputs too, so they re-apply to a rebuilt layer.
  useEffect(() => {
    layerRef.current?.setZIndex(zIndex);
  }, [zIndex, map, src, baseUrl, token, projectId, rowKey, gone]);
  useEffect(() => {
    layerRef.current?.setOpacity(opacity);
  }, [opacity, map, src, baseUrl, token, projectId, rowKey, gone]);

  const clipSide = mode === "swipe" && side !== "both" ? side : null;
  useEffect(() => {
    const layer = layerRef.current;
    if (!clipSide || !layer) return;
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
  }, [clipSide, map, workspace, src, baseUrl, token, projectId, rowKey, gone]);

  return null;
}
