import * as THREE from "three";

/** A Gulf mid-morning sun; one place, so the sky, its light and the water agree. */
export const SUN_ELEVATION_DEG = 52;
/** Clockwise from plant north. */
export const SUN_AZIMUTH_DEG = 200;
/** The warm sun colour the sky and water share: a physical scene colour, not UI. */
export const SUN_COLOUR = 0xfff1dc;

/** Unit vector towards the sun in the scene frame (x plant north, y up, z plant east). */
export function sunDirection(elevDeg = SUN_ELEVATION_DEG, azDeg = SUN_AZIMUTH_DEG): THREE.Vector3 {
  const e = THREE.MathUtils.degToRad(elevDeg);
  const a = THREE.MathUtils.degToRad(azDeg);
  return new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)).normalize();
}

/** The engine's two lights; the sun is named so it is findable and points along `sunDirection()` (the sky's sun). Physical scene colours, not UI. */
export function addSiteLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2f3a, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.name = "sun";
  sun.position.copy(sunDirection()).multiplyScalar(1000);
  scene.add(sun);
}
