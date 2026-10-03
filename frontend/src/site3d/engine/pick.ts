import type * as THREE from "three";
import type { PickHit, Pickable } from "../layers/types";

function visibleChain(o: THREE.Object3D | null): boolean {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}

/** The nearest hit over every pickable layer that is drawn, accepted by its layer, and resolves to an item. */
export function pickFirst(raycaster: THREE.Raycaster, pickables: readonly Pickable[]): PickHit | null {
  let best: PickHit | null = null;
  let bestD = Infinity;
  for (const p of pickables) {
    if (!p.root.visible) continue;
    for (const h of raycaster.intersectObject(p.root, true)) {
      if (h.distance >= bestD) break;
      if (!visibleChain(h.object)) continue;
      if (p.accepts && !p.accepts(h.point)) continue;
      const r = p.resolve(h.object);
      if (!r) continue;
      best = {
        layerId: p.layerId,
        itemId: r.itemId,
        extras: r.extras,
        point: [h.point.x, h.point.y, h.point.z],
      };
      bestD = h.distance;
      break;
    }
  }
  return best;
}
