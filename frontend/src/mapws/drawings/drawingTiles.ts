import TileLayer from "ol/layer/Tile";
import TileImage from "ol/source/TileImage";
import type BaseLayer from "ol/layer/Base";
import type TileGrid from "ol/tilegrid/TileGrid";
import type { ProjectionLike } from "ol/proj";
import { rasterTileTemplate, type TileQuery } from "@/api/drawings";
import { makeSiteTileLoader } from "../layers/siteTileLoader";

/**
 * R-W5-4 / PF6: the tile endpoints take the `t` transform (M-C0 declares it; M-B1 honours it for
 * drawing_raster), so the drawing itself moves while it is aligned. The switch stays as a fallback:
 * false makes the Overlay draw the outline instead.
 */
export const PREVIEW_TILES = true;

export interface DrawingTileCtx {
  tileGrid: TileGrid;
  projection: ProjectionLike;
  baseUrl: string;
  token: string;
  projectId: string;
}

export interface DrawingLayerHandle {
  layer: BaseLayer;
  update(q: TileQuery): void;
  /** DXF/LandXML layer names to hide: a restyle, never a refetch (spec §8.4). No-op for rasters. */
  setHidden(hidden: ReadonlySet<string>): void;
}

/**
 * One drawing's OL layer. A raster is W1's site grid with W2's status-aware tile loader (PF4: 204 is
 * an empty tile, 404/410 calls `onGone`); `update` re-URLs only when the query changed, which drops
 * the cached tiles. A vector drawing is a hidden no-op layer until slice B's vector tiles (PF5):
 * slice A must never throw for a DXF that exists through the API.
 */
export function createDrawingLayer(
  spec: { id: string; vector: boolean },
  ctx: DrawingTileCtx,
  initial: TileQuery,
  onGone: () => void,
): DrawingLayerHandle {
  if (spec.vector) {
    return { layer: new TileLayer({ visible: false }), update: () => {}, setHidden: () => {} };
  }
  const url = (q: TileQuery) => rasterTileTemplate(ctx.baseUrl, ctx.token, ctx.projectId, spec.id, q);
  const source = new TileImage({
    tileGrid: ctx.tileGrid,
    projection: ctx.projection,
    url: url(initial),
    tileLoadFunction: makeSiteTileLoader(onGone),
    transition: 0,
    interpolate: true,
  });
  // No footprint extent: an align preview moves the drawing outside its saved bounds.
  const layer = new TileLayer({ source, preload: 0 });
  return {
    layer,
    update: (q) => {
      const next = url(q);
      if (source.getUrls()?.[0] !== next) source.setUrl(next);
    },
    setHidden: () => {},
  };
}
