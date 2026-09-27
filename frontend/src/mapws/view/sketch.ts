import type OlMap from "ol/Map";
import { SELECTION_PROP } from "../layers/layerRegistry";
import type { DrawSpec } from "../tools/toolStore";
import type { Coord, Selection } from "../types";

/** The in-progress drawing: the vertices plus a rubber band to the pointer. */
export function sketchCoords(
  draft: readonly Coord[],
  pointer: Coord | null,
  draw: DrawSpec | undefined,
): { type: "LineString" | "Polygon"; coords: Coord[] } | null {
  if (!draw || draft.length === 0) return null;
  if (draw.shape !== "line" && draw.shape !== "polygon") return null;
  const coords = pointer ? [...draft, pointer] : [...draft];
  if (draw.shape === "polygon" && coords.length >= 3)
    return { type: "Polygon", coords: [...coords, coords[0]] };
  return { type: "LineString", coords };
}

/** R-W1-12: the first feature under the pixel (4 px tolerance) that carries a Selection. */
export function pickSelection(map: OlMap, pixel: number[]): Selection | null {
  let found: Selection | null = null;
  map.forEachFeatureAtPixel(
    pixel,
    (feature) => {
      const sel = feature.get(SELECTION_PROP) as Selection | undefined;
      if (sel) {
        found = sel;
        return true;
      }
      return undefined;
    },
    { hitTolerance: 4 },
  );
  return found;
}
