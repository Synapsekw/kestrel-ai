import * as THREE from "three";
import {
  PointCloudOctreePicker,
  type PickParams,
  type PointCloudOctree,
  type PointCloudOctreeNode,
} from "potree-core";
import { windowHits, type WindowHit } from "./topmost";

export interface RenderedNode {
  node: PointCloudOctreeNode;
}

/** potree-core 2.0.15's picker statics: `pick` asks `nodesOnRay` which nodes to render, renders the
 * window, reads it back, then calls `findHit(pixels, size)` (the lit pixel nearest the centre) and
 * `getPickPoint(hit, renderedNodes)`. */
interface PickerStatics {
  findHit(pixels: Uint8Array, size: number): unknown;
  getPickPoint(hit: unknown, nodes: RenderedNode[]): unknown;
  nodesOnRay(pco: PointCloudOctree, ray: THREE.Ray): PointCloudOctreeNode[];
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

/** One pick render's raw read-back: `size` × `size` RGBA (rows bottom-up), and the rendered nodes
 * (the alpha of a lit pixel is its node's index here + 1). */
export interface PickWindow {
  rgba: Uint8Array;
  size: number;
  nodes: RenderedNode[];
}

interface Spy {
  pixels: Uint8Array | null;
  size: number;
  nodes: RenderedNode[];
}

/**
 * Runs `pco.pick` with potree's statics wrapped for the length of the call: the raw pixels are copied
 * before `findHit` zeroes their alpha, the rendered nodes are kept, and, when `nodes` is given, they
 * are rendered instead of only the nodes on the ray. Null when this potree-core no longer has the
 * statics or the pick throws (potree refuses more than 255 nodes).
 */
function withPickerSpy(
  pco: PointCloudOctree,
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  ray: THREE.Ray,
  params: Partial<PickParams>,
  nodes?: PointCloudOctreeNode[],
): Spy | null {
  const statics = PointCloudOctreePicker as unknown as PickerStatics;
  const findHit = statics.findHit;
  const getPickPoint = statics.getPickPoint;
  const nodesOnRay = statics.nodesOnRay;
  if (typeof findHit !== "function" || typeof getPickPoint !== "function") return null;
  if (nodes && typeof nodesOnRay !== "function") return null;
  const spy: Spy = { pixels: null, size: 0, nodes: [] };
  statics.findHit = (pixels, size) => {
    spy.pixels = pixels.slice();
    spy.size = size;
    return findHit.call(statics, pixels, size);
  };
  statics.getPickPoint = (hit, rendered) => {
    spy.nodes = rendered;
    return getPickPoint.call(statics, hit, rendered);
  };
  if (nodes) statics.nodesOnRay = () => nodes;
  try {
    pco.pick(renderer, camera, ray, params);
  } catch {
    return null;
  } finally {
    statics.findHit = findHit;
    statics.getPickPoint = getPickPoint;
    statics.nodesOnRay = nodesOnRay;
  }
  return spy;
}

/**
 * Every point potree's picker draws in a `windowSize` pick window, in native coordinates: one render
 * and one read-back, the same cost as a plain `pco.pick`. potree-core only returns the lit pixel
 * nearest the window centre, so its statics are wrapped to see the pixels and the rendered nodes.
 * Pixels whose node index names no rendered node are dropped (potree's own pick can land on one and
 * answer null). `params` carries the clip box fallback (`clipBox.ts::pickClipParams`). Null when this
 * potree-core no longer has those statics: the caller then falls back to the plain pick, and the e2e
 * hollow-stack test fails.
 */
export function pickAllPoints(
  pco: PointCloudOctree,
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  ray: THREE.Ray,
  windowSize: number,
  params: Partial<PickParams> = {},
): DrawnPoint[] | null {
  const spy = withPickerSpy(pco, renderer, camera, ray, { ...params, pickWindowSize: windowSize });
  if (!spy) return null;
  const hits: WindowHit[] = spy.pixels ? windowHits(spy.pixels, spy.size) : [];
  const out: DrawnPoint[] = [];
  const p = new THREE.Vector3();
  for (const h of hits) {
    const node = spy.nodes[h.pcIndex]?.node;
    const scene = node?.sceneNode;
    const position = scene?.geometry?.attributes.position;
    if (!node || !scene || !position || h.pIndex >= position.count) continue;
    p.fromBufferAttribute(position, h.pIndex).applyMatrix4(scene.matrixWorld);
    out.push({ x: p.x, y: p.y, z: p.z, d2: h.d2, level: node.level });
  }
  return out;
}

/**
 * One pick render of a `windowSize` (CSS px) window centred on `pixel` (device px, y up: potree's
 * `pixelPosition`), over `nodes` (at most 254), and its raw read-back: the occlusion pass decodes
 * only the pixels near each pin from it (spec §5 "an optional pixel filter", §7).
 */
export function pickWindowPixels(
  pco: PointCloudOctree,
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  ray: THREE.Ray,
  o: {
    windowSize: number;
    pixel: THREE.Vector3;
    nodes: PointCloudOctreeNode[];
    params?: Partial<PickParams>;
  },
): PickWindow | null {
  const spy = withPickerSpy(
    pco,
    renderer,
    camera,
    ray,
    { ...(o.params ?? {}), pickWindowSize: o.windowSize, pixelPosition: o.pixel },
    o.nodes,
  );
  if (!spy?.pixels) return null;
  return { rgba: spy.pixels, size: spy.size, nodes: spy.nodes };
}
