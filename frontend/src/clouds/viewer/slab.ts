import type { PointCloudOctree } from "potree-core";
import type { Vec3 } from "./types";

export const SLAB_MAX_POINTS = 300_000;
/** 5 Hz while a line end is dragged (spec §7). */
export const SLAB_INTERVAL_MS = 200;

/** One loaded node as the sampler reads it: float32 local positions, its world matrix (three's
 * column-major `elements`, float64), and its `rgba` (4 bytes a point) when the cloud has colour. */
export interface SlabNode {
  position: ArrayLike<number>;
  count: number;
  matrix: ArrayLike<number>;
  rgba: ArrayLike<number> | null;
}

/** The cross-section preview: `s` along a→b (horizontal m), world `z`, and `rgb` (3 bytes a point,
 * null without colour). `total` is the match count before thinning; `a`, `b`, `thicknessM` echo the
 * request, so a caller can tell which drag position a throttled answer belongs to. */
export interface SlabSample {
  s: Float64Array;
  z: Float64Array;
  rgb: Uint8Array | null;
  count: number;
  total: number;
  a: Vec3;
  b: Vec3;
  thicknessM: number;
}

export function sliceSlab(
  nodes: readonly SlabNode[],
  a: Vec3,
  b: Vec3,
  thicknessM: number,
  maxPoints = SLAB_MAX_POINTS,
): SlabSample {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const hasRgb = nodes.length > 0 && nodes.every((n) => n.rgba !== null);
  const empty: SlabSample = {
    s: new Float64Array(0),
    z: new Float64Array(0),
    rgb: hasRgb ? new Uint8Array(0) : null,
    count: 0,
    total: 0,
    a,
    b,
    thicknessM,
  };
  if (!(len > 0) || !(thicknessM > 0) || !(maxPoints > 0)) return empty;
  const ux = dx / len;
  const uy = dy / len;
  const half = thicknessM / 2;

  // one pass counts, the second fills: memory is exactly the output (plan Ruling 10)
  const visit = (fn: (s: number, z: number, n: SlabNode, i: number) => void) => {
    for (const n of nodes) {
      const m = n.matrix;
      const p = n.position;
      for (let i = 0; i < n.count; i += 1) {
        const x = p[3 * i];
        const y = p[3 * i + 1];
        const zl = p[3 * i + 2];
        // float64: the node-local float32 values times the float64 matrix, never a UTM-sized float32
        const wx = m[0] * x + m[4] * y + m[8] * zl + m[12] - a[0];
        const wy = m[1] * x + m[5] * y + m[9] * zl + m[13] - a[1];
        const s = wx * ux + wy * uy;
        const t = -wx * uy + wy * ux;
        if (Math.abs(t) > half || s < 0 || s > len) continue;
        fn(s, m[2] * x + m[6] * y + m[10] * zl + m[14], n, i);
      }
    }
  };

  let total = 0;
  visit(() => {
    total += 1;
  });
  if (total === 0) return empty;
  const stride = Math.max(1, Math.ceil(total / maxPoints));
  const count = Math.ceil(total / stride);
  const s = new Float64Array(count);
  const z = new Float64Array(count);
  const rgb = hasRgb ? new Uint8Array(3 * count) : null;
  let k = 0;
  let out = 0;
  visit((sv, zv, n, i) => {
    if (k++ % stride !== 0 || out >= count) return;
    s[out] = sv;
    z[out] = zv;
    if (rgb && n.rgba) {
      rgb[3 * out] = n.rgba[4 * i];
      rgb[3 * out + 1] = n.rgba[4 * i + 1];
      rgb[3 * out + 2] = n.rgba[4 * i + 2];
    }
    out += 1;
  });
  return { s, z, rgb, count, total, a, b, thicknessM };
}

interface SceneNodeLike {
  matrixWorld: { elements: ArrayLike<number> };
  geometry?: {
    attributes: {
      position?: { array: ArrayLike<number>; count: number };
      rgba?: { array: ArrayLike<number> };
    };
  };
}

/** The visible, loaded nodes of `pco` as `SlabNode`s (potree-core 2.0's `rgba` is 4 bytes a point). */
export function slabNodes(pco: Pick<PointCloudOctree, "visibleNodes">): SlabNode[] {
  const out: SlabNode[] = [];
  for (const v of pco.visibleNodes) {
    const scene = (v as unknown as { sceneNode: SceneNodeLike | null }).sceneNode;
    const position = scene?.geometry?.attributes.position;
    if (!scene || !position) continue;
    out.push({
      position: position.array,
      count: position.count,
      matrix: scene.matrixWorld.elements,
      rgba: scene.geometry?.attributes.rgba?.array ?? null,
    });
  }
  return out;
}

export interface ThrottleClock {
  now(): number;
  later(fn: () => void, ms: number): unknown;
}

const realClock: ThrottleClock = {
  now: () => performance.now(),
  later: (fn, ms) => setTimeout(fn, ms),
};

/**
 * At most one run per `intervalMs`, trailing edge: a call inside the window replaces the pending
 * arguments, and every waiter gets the one result computed for the latest arguments.
 */
export function throttleLatest<A extends unknown[], R>(
  run: (...args: A) => R,
  intervalMs = SLAB_INTERVAL_MS,
  clock: ThrottleClock = realClock,
): (...args: A) => Promise<R> {
  let lastAt = -Infinity;
  let pending: { args: A; waiters: Array<{ resolve: (r: R) => void; reject: (e: unknown) => void }> } | null =
    null;
  const fire = () => {
    const p = pending;
    pending = null;
    if (!p) return;
    lastAt = clock.now();
    try {
      const r = run(...p.args);
      p.waiters.forEach((w) => w.resolve(r));
    } catch (e) {
      p.waiters.forEach((w) => w.reject(e));
    }
  };
  return (...args: A) =>
    new Promise<R>((resolve, reject) => {
      if (pending) {
        pending.args = args;
        pending.waiters.push({ resolve, reject });
        return;
      }
      pending = { args, waiters: [{ resolve, reject }] };
      const wait = lastAt + intervalMs - clock.now();
      if (wait <= 0) fire();
      else clock.later(fire, wait);
    });
}
