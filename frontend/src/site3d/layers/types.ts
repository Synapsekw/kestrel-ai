import type * as THREE from "three";
import type { SiteEngine } from "../engine/SiteEngine";

/** One Site 3D layer module (index binding; S2 adds cloud, water, sky, photos, findings). */
export interface SiteLayer {
  id: string;
  label: string;
  attach(e: SiteEngine): Promise<void> | void;
  detach(): void;
  setVisible(v: boolean): void;
  setOpacity?(o: number): void;
  update?(dt: number, camera: THREE.Camera): void;
}

/** What a click found: the layer, the item id (from node extras, ruling R8) and the scene point. */
export interface PickHit {
  layerId: string;
  itemId: string;
  point: [number, number, number];
  extras: Record<string, unknown>;
}

/** A layer's pickable subtree; `accepts` lets a layer refuse a point (what its cut plane hides). */
export interface Pickable {
  layerId: string;
  root: THREE.Object3D;
  resolve(object: THREE.Object3D): { itemId: string; extras: Record<string, unknown> } | null;
  accepts?(point: THREE.Vector3): boolean;
}
