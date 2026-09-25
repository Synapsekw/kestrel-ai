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

/** A drawn point in native coordinates, with its squared pixel distance from the window centre and
 * its node's octree level. */
export interface DrawnPoint {
  x: number;
  y: number;
  z: number;
  d2: number;
  level: number;
}

/**
 * Every point potree's picker draws in a `windowSize` pick window, in native coordinates: one render
 * and one read-back, the same cost as a plain `pco.pick`. potree-core only returns the lit pixel
 * nearest the window centre, so its two statics are wrapped for the length of the call to see the
 * pixels and the rendered nodes. Pixels whose node index names no rendered node are dropped
 * (potree's own pick can land on one and answer null). Null when this potree-core no longer has
 * those statics: the caller then falls back to the plain pick, and the e2e hollow-stack test fails.
 */
export function pickAllPoints(
  pco: PointCloudOctree,
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  ray: THREE.Ray,
  windowSize: number,
): DrawnPoint[] | null {
  const statics = PointCloudOctreePicker as unknown as PickerStatics;
  const findHit = statics.findHit;
  const getPickPoint = statics.getPickPoint;
  if (typeof findHit !== "function" || typeof getPickPoint !== "function") return null;
  let hits: WindowHit[] = [];
  let nodes: RenderedNode[] = [];
  statics.findHit = (pixels, size) => {
    hits = windowHits(pixels, size);
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
  const out: DrawnPoint[] = [];
  const p = new THREE.Vector3();
  for (const h of hits) {
    const node = nodes[h.pcIndex]?.node;
    const scene = node?.sceneNode;
    const position = scene?.geometry?.attributes.position;
    if (!node || !scene || !position || h.pIndex >= position.count) continue;
    p.fromBufferAttribute(position, h.pIndex).applyMatrix4(scene.matrixWorld);
    out.push({ x: p.x, y: p.y, z: p.z, d2: h.d2, level: node.level });
  }
  return out;
}
