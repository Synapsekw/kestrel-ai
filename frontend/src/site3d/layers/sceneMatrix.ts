import * as THREE from "three";
import { siteToScene, type SiteFrameT } from "@/site3d/engine/siteTransform";

/**
 * The affine map from site CRS (x, y, cloud z) to the scene, with `plant EL = z + zOffsetM`, sampled
 * from S1's `siteToScene` around the plant origin (so the rotation is never derived twice). Float64
 * throughout: three's Matrix4 keeps plain numbers, and potree offsets each node, so the UTM-sized
 * translation never reaches a float32 vertex.
 */
export function siteToSceneMatrix(f: SiteFrameT, zOffsetM: number): THREE.Matrix4 {
  const [ox, oy] = f.origin_crs;
  const o = siteToScene(f, ox, oy, zOffsetM);
  const ex = siteToScene(f, ox + 1, oy, zOffsetM);
  const ey = siteToScene(f, ox, oy + 1, zOffsetM);
  const ez = siteToScene(f, ox, oy, zOffsetM + 1);
  const a = [ex[0] - o[0], ex[1] - o[1], ex[2] - o[2]];
  const b = [ey[0] - o[0], ey[1] - o[1], ey[2] - o[2]];
  const c = [ez[0] - o[0], ez[1] - o[1], ez[2] - o[2]];
  // Matrix4.set takes rows; a, b, c are the columns (the images of the site x, y, z unit vectors).
  const m = new THREE.Matrix4().set(
    a[0],
    b[0],
    c[0],
    0,
    a[1],
    b[1],
    c[1],
    0,
    a[2],
    b[2],
    c[2],
    0,
    0,
    0,
    0,
    1,
  );
  const t = new THREE.Vector3(ox, oy, 0).applyMatrix4(m);
  m.setPosition(o[0] - t.x, o[1] - t.y, o[2] - t.z);
  return m;
}
