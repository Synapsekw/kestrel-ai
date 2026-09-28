import Feature, { type FeatureLike } from "ol/Feature";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import TileLayer from "ol/layer/Tile";
import VectorTileLayer from "ol/layer/VectorTile";
import TileImage from "ol/source/TileImage";
import VectorTileSource from "ol/source/VectorTile";
import { Fill, Stroke, Style, Text } from "ol/style";
import TileState from "ol/TileState";
import type BaseLayer from "ol/layer/Base";
import type Tile from "ol/Tile";
import type TileGrid from "ol/tilegrid/TileGrid";
import type VectorTile from "ol/VectorTile";
import type { ProjectionLike } from "ol/proj";
import {
  rasterTileTemplate,
  vectorTileTemplate,
  type Drawing,
  type DrawingVectorTile,
  type TileQuery,
} from "@/api/drawings";
import { tokenColour } from "@/maps/styles";
import { SELECTION_PROP } from "../layers/layerRegistry";
import type { Selection } from "../types";
import { classifyTileStatus, makeSiteTileLoader } from "../layers/siteTileLoader";

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
 * the cached tiles. A vector drawing (DXF/LandXML) is a `VectorTileLayer` over the same grid: its JSON
 * tiles go through the same status rules, and `setHidden` restyles the loaded tiles without refetching.
 */
export function createDrawingLayer(
  spec: { id: string; vector: boolean },
  ctx: DrawingTileCtx,
  initial: TileQuery,
  onGone: () => void,
): DrawingLayerHandle {
  if (spec.vector) return createVectorLayer(spec.id, ctx, initial, onGone);
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

export const LABEL_MIN_PX = 6;
export const LABEL_MAX_PX = 48;
const LABEL_FONT = '"Space Grotesk Variable", system-ui, sans-serif';

/**
 * Site-frame features for one tile: a LineString per run (flat x0, y0, x1, y1, …; a run under two
 * vertices is dropped) and a Point per label. With `drawingId`, each carries the drawing's Selection so
 * a click on the linework selects the drawing (PF11).
 */
export function vtileFeatures(json: DrawingVectorTile, drawingId?: string): Feature[] {
  const sel: Selection | undefined = drawingId ? { kind: "drawing", id: drawingId } : undefined;
  const tag = (f: Feature) => {
    if (sel) f.set(SELECTION_PROP, sel, true);
    return f;
  };
  const out: Feature[] = [];
  for (const layer of json.layers)
    for (const flat of layer.lines)
      if (flat.length >= 4)
        out.push(tag(new Feature({ geometry: new LineString(flat, "XY"), layer: layer.name })));
  for (const l of json.labels)
    out.push(
      tag(
        new Feature({
          geometry: new Point([l.x, l.y]),
          text: l.text,
          height_m: l.height_m,
          rotation: l.rotation,
          // `DrawingLabel.layer` is optional in the contract; without it a label follows no layer toggle.
          labelLayer: l.layer ?? null,
        }),
      ),
    );
  return out;
}

/**
 * The vector tiles' `tileLoadFunction`, on W2's status rules (`classifyTileStatus`, PF4): 204 is an
 * empty tile; 404/410 errors the tile and calls `onGone`; anything else (409 `not_placed`, 422
 * `not_vector`/`no_coordinates`/`invalid_preview`) is a plain tile error.
 */
export function vectorTileLoader(onGone: () => void, drawingId?: string) {
  return (tile: Tile, url: string): void => {
    const vt = tile as VectorTile<Feature>;
    fetch(url)
      .then(async (res) => {
        const outcome = classifyTileStatus(res.status);
        if (outcome === "image") {
          vt.setFeatures(vtileFeatures((await res.json()) as DrawingVectorTile, drawingId));
          return;
        }
        if (outcome === "empty") {
          vt.setFeatures([]);
          return;
        }
        vt.setState(TileState.ERROR);
        if (outcome === "gone") onGone();
      })
      .catch(() => vt.setState(TileState.ERROR));
  };
}

/** R-W5-6 and R-W5-13: one colour; hidden layers get no style (no refetch); labels from 6 px. */
export function drawingStyle(o: { hidden: ReadonlySet<string>; colour: string }) {
  const line = new Style({ stroke: new Stroke({ color: o.colour, width: 1.25 }) });
  const fill = new Fill({ color: o.colour });
  return (f: FeatureLike, resolution: number): Style | undefined => {
    const text = f.get("text") as string | undefined;
    if (text === undefined) return o.hidden.has(f.get("layer") as string) ? undefined : line;
    const labelLayer = f.get("labelLayer") as string | null;
    if (labelLayer !== null && o.hidden.has(labelLayer)) return undefined;
    const px = (f.get("height_m") as number) / resolution;
    if (px < LABEL_MIN_PX) return undefined;
    return new Style({
      text: new Text({
        text,
        font: `${Math.min(LABEL_MAX_PX, Math.round(px))}px ${LABEL_FONT}`,
        rotation: -((f.get("rotation") as number) * Math.PI) / 180,
        fill,
      }),
    });
  };
}

export function hiddenLayers(d: Drawing): Set<string> {
  return new Set(d.layer_state.hidden_layers);
}

function createVectorLayer(
  id: string,
  ctx: DrawingTileCtx,
  initial: TileQuery,
  onGone: () => void,
): DrawingLayerHandle {
  // Knockout is a raster option: vector tiles never carry it.
  const url = (q: TileQuery) =>
    vectorTileTemplate(ctx.baseUrl, ctx.token, ctx.projectId, id, { ...q, knockout: false });
  const source = new VectorTileSource<Feature>({
    tileGrid: ctx.tileGrid,
    projection: ctx.projection,
    url: url(initial),
    tileLoadFunction: vectorTileLoader(onGone, id),
    transition: 0,
  });
  const colour = tokenColour("ok");
  const layer = new VectorTileLayer({
    source,
    renderMode: "hybrid",
    preload: 0,
    style: drawingStyle({ hidden: new Set(), colour }),
  });
  return {
    layer,
    update: (q) => {
      const next = url(q);
      if (source.getUrls()?.[0] !== next) source.setUrl(next);
    },
    setHidden: (hidden) => layer.setStyle(drawingStyle({ hidden, colour })),
  };
}
