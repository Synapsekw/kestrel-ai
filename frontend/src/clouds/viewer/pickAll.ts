import * as THREE from "three";
import { PointCloudOctreePicker, type PointCloudOctree, type PointCloudOctreeNode } from "potree-core";
import { windowHits, type WindowHit } from "./topmost";

interface RenderedNode {
  node: PointCloudOctreeNode;
}

/** potree-core 2.0.15's picker statics: `pick` renders the window, reads it back, then calls
 * `findHit(pixels, size)` (the lit pixel nearest the centre) and `getPickPoint(hit, renderedNodes)`. */
interface PickerStatics {
  findHit(pixels: Uint8Array, size: number): unknown;
  getPickPoint(hit: unknown, nodes: RenderedNode[]): unknown;
}

/**
 * Every point potree's picker draws in a `windowSize` pick window, in native coordinates: one render
 * and one read-back, the same cost as a plain `pco.pick`. potree-core only returns the lit pixel
 * nearest the window centre, so its two statics are wrapped for the length of the call to see the
 * pixels and the rendered nodes. Null when this potree-core no longer has them (the caller then
 * falls back to the plain pick; the e2e hollow-ring test would fail).
 */
export function pickAllPoints(
  pco: PointCloudOctree,
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  ray: THREE.Ray,
  windowSize: number,
): THREE.Vector3[] | null {
  const statics = PointCloudOctreePicker as unknown as PickerStatics;
  const findHit = statics.findHit;
  const getPickPoint = statics.getPickPoint;
  if (typeof findHit !== "function" || typeof getPickPoint !== "function") return null;
  let hits: WindowHit[] = [];
  let nodes: RenderedNode[] = [];
  statics.findHit = (pixels, size) => {
    hits = windowHits(pixels);
    return findHit.call(statics, pixels, size);
  };
  statics.getPickPoint = (hit, rendered) => {
    nodes = rendered;
    return getPickPoint.call(statics, hit, rendered);
  };
  try {
    pco.pick(renderer, camera, ray, { pickWindowSize: windowSize });
  } finally {
    statics.findHit = findHit;
    statics.getPickPoint = getPickPoint;
  }
  const out: THREE.Vector3[] = [];
  for (const h of hits) {
    const scene = nodes[h.pcIndex]?.node.sceneNode;
    const position = scene?.geometry?.attributes.position;
    if (!scene || !position || h.pIndex >= position.count) continue;
    out.push(new THREE.Vector3().fromBufferAttribute(position, h.pIndex).applyMatrix4(scene.matrixWorld));
  }
  return out;
}
