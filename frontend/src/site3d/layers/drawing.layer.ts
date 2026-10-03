import type { SceneDrawing } from "@/api/siteScene";
import { minZoomFor } from "../engine/tiles";
import { TileDrapeLayer, extent } from "./tileDrape";

/** Drawings at grade, just above the ortho and drawn after it (ruling R9); zooms by ruling R7. */
export const DRAWING_Y = 0.05;
export const DRAWING_MAX_Z = 19;
export const DRAWING_OPACITY = 0.85;

export function createDrawingLayer(
  d: SceneDrawing,
  url: (rel: string) => string,
  onGone?: () => void,
): TileDrapeLayer {
  const bounds = extent(d.bounds_site);
  return new TileDrapeLayer(
    {
      id: `drawing:${d.id}`,
      label: d.name,
      template: url(d.tile_url_template),
      bounds,
      minZ: minZoomFor(bounds, DRAWING_MAX_Z),
      maxZ: DRAWING_MAX_Z,
      sceneY: DRAWING_Y,
      renderOrderBase: 100,
      opacity: DRAWING_OPACITY,
    },
    onGone,
  );
}
