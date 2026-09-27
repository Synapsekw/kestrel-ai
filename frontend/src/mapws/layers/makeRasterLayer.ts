import TileLayer from "ol/layer/Tile";
import TileImage from "ol/source/TileImage";
import type { ProjectionLike } from "ol/proj";
import type { SiteExtent } from "../view/siteGrid";
import { fillTile, siteTileGrid, siteTileUrl } from "../view/siteFrame";
import { makeSiteTileLoader } from "./siteTileLoader";

export interface RasterSource {
  kind: "map" | "surface";
  id: string;
  version: string;
  maxZoom: number | null;
  extent: SiteExtent | null;
  extras: Record<string, string>;
}

export interface RasterContext {
  projection: ProjectionLike;
  baseUrl: string;
  token: string;
  projectId: string;
  onGone: () => void;
}

/** One site-tile layer (M §6): W1's site grid, clamped to the footprint, tiles fetched by status. */
export function makeRasterLayer(src: RasterSource, ctx: RasterContext): TileLayer<TileImage> {
  const template = siteTileUrl(
    ctx.baseUrl,
    ctx.token,
    ctx.projectId,
    src.kind,
    src.id,
    src.version,
    src.extras,
  );
  const source = new TileImage({
    projection: ctx.projection,
    tileGrid: siteTileGrid(src.maxZoom ?? undefined),
    tileUrlFunction: (c) => (c ? fillTile(template, c) : undefined),
    tileLoadFunction: makeSiteTileLoader(ctx.onGone),
    transition: 0,
    interpolate: true,
  });
  return new TileLayer({
    source,
    extent: src.extent ?? undefined,
    preload: 0,
  });
}
