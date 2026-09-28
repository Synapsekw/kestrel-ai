import { useEffect, useMemo, useRef } from "react";
import type OlMap from "ol/Map";
import { useBackend } from "@/api/client";
import { frameKey, type TileQuery } from "@/api/drawings";
import { bumpWorkspaceData } from "../data/bump";
import { useAlignStore } from "../georef/alignStore";
import type { AlignSession } from "../georef/alignModel";
import { useGoneLayers } from "../layers/goneLayers";
import type { LayerMountProps, LayerRow } from "../layers/layerRegistry";
import type { SiteFrame } from "../types";
import { siteTileGrid } from "../view/siteFrame";
import { useAlignMarks } from "./alignMarks";
import { createDrawingLayer, hiddenLayers, PREVIEW_TILES, type DrawingLayerHandle } from "./drawingTiles";
import { useDrawing } from "./drawingsStore";
import { useDebouncedValue } from "./useDebouncedValue";

export const PREVIEW_DEBOUNCE_MS = 250;
/** Spec §8.3: the drawing being aligned shows at 50% of its row opacity. */
const ALIGN_OPACITY = 0.5;

/**
 * W1 layer Mount for one Drawings row on one map side. It owns the drawing's OL layers: the site
 * tiles, and the align session's marks layer (bubbles, residual lines, outline) beside them, because
 * W1 renders tool Overlays outside the map pane (PF9).
 */
export function DrawingMount({ row, map, zIndex, opacity, projectId, frame }: LayerMountProps) {
  const drawing = useDrawing(projectId, row.id);
  const session = useAlignStore((s) => (s.session?.drawingId === row.id ? s.session : null));
  const ready = (drawing?.status ?? row.layer?.status) === "ready";
  const placed = drawing ? drawing.georef !== null : row.layer?.placed === true;
  const knockout = drawing?.layer_state.knockout_white === true;
  // A stable key, so a list refetch with the same hidden layers does not restyle.
  const hiddenKey = drawing ? [...hiddenLayers(drawing)].sort().join("\n") : "";
  useDrawingTiles({
    row,
    map,
    zIndex,
    opacity,
    projectId,
    frame,
    knockout,
    hiddenKey,
    session,
    ready,
    placed,
    // Final review #6: the drawing's own georef_version (the row's `version`, layers.py) arrives
    // with a Save's upsert; the row's lags until the workspace refetch, which would snap back.
    version: drawing ? String(drawing.georef_version) : (row.version ?? "0"),
  });
  useAlignMarks(map, session);
  return null;
}

interface TilesInput {
  row: LayerRow;
  map: OlMap;
  zIndex: number;
  opacity: number;
  projectId: string;
  frame: SiteFrame;
  knockout: boolean;
  /** DXF/LandXML layer names to hide, joined by newlines (a restyle, never a refetch). */
  hiddenKey: string;
  session: AlignSession | null;
  ready: boolean;
  placed: boolean;
  version: string;
}

/**
 * The drawing's tile layer (raster tiles, or vector tiles for DXF/LandXML). Built, added, removed and
 * disposed inside one effect, only when its source must change (RasterMount's pattern); the version,
 * knockout and preview transform re-URL it; visibility, opacity, z and hidden layers are property
 * updates.
 */
function useDrawingTiles(input: TilesInput) {
  const {
    row,
    map,
    zIndex,
    opacity,
    projectId,
    frame,
    knockout,
    hiddenKey,
    session,
    ready,
    placed,
    version,
  } = input;
  const { baseUrl, token } = useBackend();
  const gone = useGoneLayers((s) => s.gone.has(row.key));
  const vector = row.layer?.vector === true;
  const maxZoom = row.layer?.max_zoom ?? null;
  const projection = map.getView().getProjection();
  // PF3: `frame_key` is the site tiles' cache key (siteCode); a frame switch is a new URL and layer.
  const fkey = frameKey(frame);
  // A preview settles per session (`epoch`): a quick K restart never shows the previous transform.
  const epoch = useAlignStore((s) => s.epoch);
  const transform = session?.transform ?? null;
  const live = useMemo(() => (PREVIEW_TILES && transform ? { epoch, transform } : null), [epoch, transform]);
  const settled = useDebouncedValue(live, PREVIEW_DEBOUNCE_MS);
  const activePreview = session && settled?.epoch === epoch ? settled.transform : null;

  // The toast names the row as it reads now, and the build starts from the latest query, without
  // either one rebuilding the layer.
  const nameRef = useRef(row.name);
  const queryRef = useRef<TileQuery>({ v: version, frame: fkey });
  useEffect(() => {
    nameRef.current = row.name;
    queryRef.current = { v: version, frame: fkey, preview: activePreview, knockout };
  }, [row.name, version, fkey, activePreview, knockout]);

  const handleRef = useRef<DrawingLayerHandle | null>(null);
  const rowId = row.id;
  const rowKey = row.key;
  useEffect(() => {
    if (gone) return;
    const h = createDrawingLayer(
      { id: rowId, vector },
      { tileGrid: siteTileGrid(maxZoom ?? undefined), projection, baseUrl, token, projectId },
      queryRef.current,
      // Every 404/410 tile calls this, on every side; only the first drops the row (W2-9, PF4).
      () => {
        const g = useGoneLayers.getState();
        if (g.gone.has(rowKey)) return;
        g.markGone(rowKey, nameRef.current);
        bumpWorkspaceData();
      },
    );
    handleRef.current = h;
    map.addLayer(h.layer);
    return () => {
      map.removeLayer(h.layer);
      h.layer.dispose();
      if (handleRef.current === h) handleRef.current = null;
    };
  }, [map, rowId, rowKey, vector, maxZoom, projection, fkey, baseUrl, token, projectId, gone]);

  // Declared after the build effect, and keyed by its inputs too, so they re-apply to a rebuilt layer.
  // An unplaced drawing has no tiles until its first `t` preview (Task 7 review carry-over).
  const shown = ready && (placed || activePreview !== null);
  const aligning = session !== null;
  useEffect(() => {
    const layer = handleRef.current?.layer;
    if (!layer) return;
    layer.setVisible(shown);
    layer.setOpacity(opacity * (aligning ? ALIGN_OPACITY : 1));
    layer.setZIndex(zIndex);
  }, [
    shown,
    aligning,
    opacity,
    zIndex,
    map,
    rowId,
    rowKey,
    vector,
    maxZoom,
    projection,
    fkey,
    baseUrl,
    token,
    projectId,
    gone,
  ]);

  useEffect(() => {
    handleRef.current?.update({ v: version, frame: fkey, preview: activePreview, knockout });
  }, [
    version,
    activePreview,
    knockout,
    map,
    rowId,
    rowKey,
    vector,
    maxZoom,
    projection,
    fkey,
    baseUrl,
    token,
    projectId,
    gone,
  ]);

  useEffect(() => {
    handleRef.current?.setHidden(new Set(hiddenKey ? hiddenKey.split("\n") : []));
  }, [hiddenKey, map, rowId, rowKey, vector, maxZoom, projection, fkey, baseUrl, token, projectId, gone]);
}
