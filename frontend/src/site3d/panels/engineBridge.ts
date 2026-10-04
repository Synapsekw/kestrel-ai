import type * as THREE from "three";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";
import { MODEL_LAYER_ID, type ColourBy } from "@/site3d/layers/model.layer";
import type { PickHit } from "@/site3d/layers/types";

export type { ColourBy };

export const COLOUR_BY: readonly { value: ColourBy; label: string }[] = [
  { value: "material", label: "Material" },
  { value: "type", label: "Type" },
  { value: "area", label: "Area" },
  { value: "height_source", label: "Height source" },
  { value: "flag", label: "Flags" },
];

/**
 * What S3's panels drive in the 3D view. The only module that knows S1's names. A new version's GLB
 * is not loaded from here: SiteView swaps it on a `modelUrl` change (ruling R-S3-10, one swap path).
 */
export interface SiteControls {
  flyTo(box: THREE.Box3): void;
  /** Selects an item by its id (= its GLB node name, A1), or clears with null. */
  select(node: string | null): void;
  onSelect(cb: (node: string | null) => void): () => void;
  boxOf(node: string): THREE.Box3 | null;
  setColourBy(mode: ColourBy): void;
}

/** S1's model layer (`ModelLayer`) as S3 uses it. */
export interface ModelLayerLike {
  select(itemId: string | null): void;
  itemBox(itemId: string): THREE.Box3 | null;
  setColourBy(mode: ColourBy): void;
}

export function controlsOf(engine: SiteEngine, model: ModelLayerLike): SiteControls {
  return {
    flyTo: (box) => engine.flyTo(box),
    select: (node) => model.select(node),
    onSelect: (cb) =>
      engine.onSelect((hit: PickHit | null) => cb(hit && hit.layerId === MODEL_LAYER_ID ? hit.itemId : null)),
    boxOf: (node) => model.itemBox(node),
    setColourBy: (mode) => model.setColourBy(mode),
  };
}
