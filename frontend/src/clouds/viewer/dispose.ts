import type { Material, Object3D } from "three";

type Drawable = Object3D & { geometry?: { dispose(): void }; material?: Material | Material[] };

function disposeDrawable(o: Object3D): void {
  const d = o as Drawable;
  d.geometry?.dispose();
  const m = d.material;
  if (Array.isArray(m)) m.forEach((x) => x.dispose());
  else m?.dispose();
}

/** Removes the children `match` selects (all of them without one) and releases the GPU buffers and
 * materials of each, descendants included: an overlay redrawn at hover rate must not leak. */
export function disposeChildren(group: Object3D, match: (child: Object3D) => boolean = () => true): void {
  for (const child of group.children.filter(match)) {
    group.remove(child);
    child.traverse(disposeDrawable);
  }
}

/** potree-core 2.0.15's geometry-node dispose skips the root node (it only disposes a node with a
 * parent), so the viewer releases every Points geometry itself before `pco.dispose()`. The shared
 * PointCloudMaterial stays potree-core's to dispose. */
export function disposePointsGeometries(root: Object3D): void {
  root.traverse((o) => {
    if ((o as Object3D & { isPoints?: boolean }).isPoints) (o as Drawable).geometry?.dispose();
  });
}
